use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result, anyhow};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

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

pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU64,
    instances: Mutex<HashMap<u64, PtyInstance>>,
}

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
    cwd: &Path,
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
    cmd.cwd(cwd);
    apply_common_env(&mut cmd, bin_dir);
    shell.apply_env(&mut cmd, integration_dir);
    Ok(cmd)
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    events: Channel<PtyEvent>,
    cols: u16,
    rows: u16,
) -> CommandResult<u64> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let cwd = etcetera::home_dir().context("failed to resolve home dir")?;
    let shell_path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell = Shell::detect(&shell_path);
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve resource dir")?;
    let integration_dir = resource_dir.join("shell");
    let bin_dir = resource_dir.join("bin");
    let cmd = build_command(&shell_path, &shell, &integration_dir, &bin_dir, &cwd)?;

    let mut child = pair
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

    state.instances.lock().unwrap().insert(
        id,
        PtyInstance {
            master: pair.master,
            writer,
        },
    );

    let osc_app = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut parser = vte::Parser::new();
        let mut performer = OscPerformer::new(osc_app, id);
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
        let _ = child.wait();
        let _ = events.send(PtyEvent::Exit);
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u64, data: String) -> CommandResult<()> {
    let mut guard = state.instances.lock().unwrap();
    let inst = guard
        .get_mut(&id)
        .ok_or_else(|| anyhow!("pty {id} not found"))?;
    inst.writer
        .write_all(data.as_bytes())
        .context("failed to write to pty")?;
    inst.writer.flush().context("failed to flush pty")?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u64, cols: u16, rows: u16) -> CommandResult<()> {
    let guard = state.instances.lock().unwrap();
    let inst = guard
        .get(&id)
        .ok_or_else(|| anyhow!("pty {id} not found"))?;
    inst.master
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
pub fn pty_close(state: State<'_, PtyState>, id: u64) -> CommandResult<()> {
    state.instances.lock().unwrap().remove(&id);
    Ok(())
}
