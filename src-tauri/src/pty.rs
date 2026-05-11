use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, ResourceId};

use crate::osc::OscPerformer;

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

type CommandResult<T> = Result<T, CommandError>;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "data")]
pub enum PtyEvent {
    Data(Vec<u8>),
    Exit,
}

pub struct PtyHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
}

impl tauri::Resource for PtyHandle {}

enum Shell {
    Bash,
    Zsh,
    Fish,
    Nu,
    Other,
}

impl Shell {
    fn detect(path: &str) -> Self {
        match Path::new(path).file_name().and_then(|n| n.to_str()) {
            Some("bash") => Self::Bash,
            Some("zsh") => Self::Zsh,
            Some("fish") => Self::Fish,
            Some("nu") => Self::Nu,
            _ => Self::Other,
        }
    }

    fn exec_inner(&self, shell: &str, integration_dir: &Path) -> String {
        let shell = sh_quote(shell);
        match self {
            Self::Bash => {
                let rcfile = integration_dir
                    .join("bash")
                    .join(concat!(env!("CARGO_PKG_NAME"), ".bash"));
                let rcfile = sh_quote(&rcfile.to_string_lossy());
                format!("exec {shell} --rcfile {rcfile}")
            }
            _ => format!("exec -l {shell}"),
        }
    }

    fn apply_env(&self, cmd: &mut CommandBuilder, integration_dir: &Path) {
        match self {
            Self::Zsh => {
                if let Ok(prev) = std::env::var("ZDOTDIR") {
                    cmd.env("PIYO_ZSH_ZDOTDIR", prev);
                }
                cmd.env("ZDOTDIR", integration_dir.join("zsh"));
            }
            Self::Fish | Self::Nu => {
                let dir = integration_dir.to_string_lossy();
                let existing = std::env::var("XDG_DATA_DIRS")
                    .unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
                let data_dirs = if existing.split(':').any(|p| p == dir) {
                    existing
                } else {
                    format!("{dir}:{existing}")
                };
                cmd.env("XDG_DATA_DIRS", data_dirs);
            }
            Self::Bash | Self::Other => {}
        }
    }
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn hushlogin() -> bool {
    etcetera::home_dir()
        .map(|home| home.join(".hushlogin").exists())
        .unwrap_or(false)
}

fn apply_common_env(cmd: &mut CommandBuilder, bin_dir: &Path) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", env!("CARGO_PKG_NAME"));
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
    cmd.env("LANG", lang);
    cmd.env("PIYO_BIN", bin_dir);
}

fn build_command(
    shell_path: &str,
    shell: &Shell,
    integration_dir: &Path,
    bin_dir: &Path,
    cwd: Option<&Path>,
) -> Result<CommandBuilder> {
    let user = whoami::username().context("failed to read current username")?;
    let flags = if hushlogin() { "-flpq" } else { "-flp" };
    let mut cmd = CommandBuilder::new("/usr/bin/login");
    cmd.arg(flags);
    cmd.arg(user);
    cmd.arg("/bin/bash");
    cmd.arg("--noprofile");
    cmd.arg("--norc");
    cmd.arg("-c");
    cmd.arg(shell.exec_inner(shell_path, integration_dir));
    apply_common_env(&mut cmd, bin_dir);
    shell.apply_env(&mut cmd, integration_dir);
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    Ok(cmd)
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    events: Channel<PtyEvent>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> CommandResult<ResourceId> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let shell_path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell = Shell::detect(&shell_path);
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve resource dir")?;
    let integration_dir = resource_dir.join("shell");
    let bin_dir = resource_dir.join("bin");
    let cwd_path = cwd.as_ref().map(Path::new).filter(|p| p.is_dir());
    let cmd = build_command(&shell_path, &shell, &integration_dir, &bin_dir, cwd_path)?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .context("failed to spawn shell")?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .context("failed to clone pty reader")?;
    let writer = pair
        .master
        .take_writer()
        .context("failed to take pty writer")?;

    let child = Arc::new(Mutex::new(Some(child)));
    let child_for_reader = child.clone();

    let handle = PtyHandle {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child,
    };

    let rid = app.resources_table().add(handle);

    let app_for_osc = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut parser = vte::Parser::new();
        let mut performer = OscPerformer::new(app_for_osc.clone(), rid);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    parser.advance(&mut performer, &buf[..n]);
                    if events.send(PtyEvent::Data(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let taken = child_for_reader.lock().unwrap().take();
        if let Some(mut c) = taken {
            let _ = c.wait();
        }
        let _ = events.send(PtyEvent::Exit);
        let _ = tauri::Emitter::emit(&app_for_osc, "pty:exit", &serde_json::json!({ "rid": rid }));
    });

    Ok(rid)
}

#[tauri::command]
pub fn pty_write(app: AppHandle, rid: ResourceId, data: String) -> CommandResult<()> {
    let handle = app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?;
    let mut writer = handle.writer.lock().unwrap();
    writer
        .write_all(data.as_bytes())
        .context("failed to write to pty")?;
    writer.flush().context("failed to flush pty")?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(app: AppHandle, rid: ResourceId, cols: u16, rows: u16) -> CommandResult<()> {
    let handle = app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?;
    handle
        .master
        .lock()
        .unwrap()
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to resize pty")?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(app: AppHandle, rid: ResourceId) -> CommandResult<()> {
    let handle = match app.resources_table().get::<PtyHandle>(rid) {
        Ok(h) => h,
        Err(_) => return Ok(()),
    };
    if let Some(child) = handle.child.lock().unwrap().as_mut() {
        let _ = child.kill();
    }
    drop(handle);
    let _ = app.resources_table().close(rid);
    Ok(())
}
