use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, ResourceId};

use crate::osc::OscPerformer;
use crate::vt::{self, Frame};

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

pub type CommandResult<T> = Result<T, CommandError>;

const READ_BUF_SIZE: usize = 4096;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "data")]
pub enum PtyEvent {
    Frame(Frame),
    Exit,
}

/// Messages flowing into the session thread. The reader thread sends
/// `Bytes` / `Shutdown`; Tauri commands send the rest. All session-state
/// mutation happens on the session thread because the ghostty `Terminal`
/// is `!Send`.
enum SessionMsg {
    Bytes(Vec<u8>),
    Scroll(isize),
    Resize { cols: u16, rows: u16 },
    Shutdown,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    rid: ResourceId,
    shell: String,
}

type ChildHandle = Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>;

pub struct PtyHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: vt::PtyWriter,
    child: ChildHandle,
    /// Channel into the session thread; commands clone this to dispatch
    /// state-mutating work. `Sender` is `!Sync`, so park behind a `Mutex`.
    session_tx: Mutex<Sender<SessionMsg>>,
    /// Snapshot of the terminal modes the key / mouse encoders need.
    pub modes: vt::SharedModes,
}

impl PtyHandle {
    fn session_sender(&self) -> Sender<SessionMsg> {
        self.session_tx.lock().unwrap().clone()
    }
}

fn reap(child: &ChildHandle) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.wait();
    }
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

#[cfg(unix)]
fn login_shell_from_passwd() -> Option<String> {
    use uzers::os::unix::UserExt;
    let user = uzers::get_user_by_uid(uzers::get_current_uid())?;
    let shell = user.shell().to_str()?;
    if shell.is_empty() {
        None
    } else {
        Some(shell.to_owned())
    }
}

#[cfg(not(unix))]
fn login_shell_from_passwd() -> Option<String> {
    None
}

fn resolve_shell_path() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(login_shell_from_passwd)
        .unwrap_or_else(|| "/bin/sh".into())
}

struct ResourceDirs {
    integration: PathBuf,
    bin: PathBuf,
    scripts: PathBuf,
}

impl ResourceDirs {
    fn from_resource_dir(resource_dir: &Path) -> Self {
        Self {
            integration: resource_dir.join("shell"),
            bin: resource_dir.join("bin"),
            scripts: resource_dir.join("scripts"),
        }
    }
}

fn apply_common_env(cmd: &mut CommandBuilder, dirs: &ResourceDirs) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", env!("CARGO_PKG_NAME"));
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
    cmd.env("LANG", lang);
    cmd.env("PIYO_BIN", &dirs.bin);
    cmd.env("PIYO_SCRIPTS", &dirs.scripts);
}

fn build_command(
    shell_path: &str,
    shell: &Shell,
    dirs: &ResourceDirs,
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
    cmd.arg(shell.exec_inner(shell_path, &dirs.integration));
    apply_common_env(&mut cmd, dirs);
    shell.apply_env(&mut cmd, &dirs.integration);
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
) -> CommandResult<PtySpawned> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let shell_path = resolve_shell_path();
    let shell_name = Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_string();
    let shell = Shell::detect(&shell_path);
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve resource dir")?;
    let dirs = ResourceDirs::from_resource_dir(&resource_dir);
    let cwd_path = cwd.as_ref().map(Path::new).filter(|p| p.is_dir());
    let cmd = build_command(&shell_path, &shell, &dirs, cwd_path)?;

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

    let child: ChildHandle = Arc::new(Mutex::new(Some(child)));
    let child_for_reader = child.clone();

    let writer: vt::PtyWriter = Arc::new(Mutex::new(writer));
    let writer_for_vt = writer.clone();
    let modes: vt::SharedModes = Arc::new(Mutex::new(vt::Modes::default()));
    let modes_for_vt = modes.clone();

    let (session_tx, session_rx) = std::sync::mpsc::channel::<SessionMsg>();
    let session_tx_for_reader = session_tx.clone();

    let handle = PtyHandle {
        master: Mutex::new(pair.master),
        writer,
        child,
        session_tx: Mutex::new(session_tx),
        modes,
    };

    let rid = app.resources_table().add(handle);

    // Reader thread: blocking PTY reads, vte OSC sniffing for piyo-specific
    // codes (7, 9, 777, 7496) that ghostty has no native callback for, then
    // forward the raw bytes to the session thread.
    let app_for_osc = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut parser = vte::Parser::new();
        let mut performer = OscPerformer::new(app_for_osc, rid);
        let mut buf = [0u8; READ_BUF_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    parser.advance(&mut performer, chunk);
                    if session_tx_for_reader
                        .send(SessionMsg::Bytes(chunk.to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = session_tx_for_reader.send(SessionMsg::Shutdown);
    });

    // Session thread: owns the ghostty Terminal (which is `!Send`).
    // Single consumer of the SessionMsg channel — serialises bytes from the
    // PTY, scroll requests from the frontend, and resize events.
    let app_for_exit = app.clone();
    std::thread::spawn(move || {
        let mut session = match vt::Session::new(
            cols,
            rows,
            writer_for_vt,
            modes_for_vt,
            app_for_exit.clone(),
            rid,
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("ghostty vt session init failed: {e:#}");
                return;
            }
        };

        let emit_frame = |frame_result: Result<Option<Frame>>| -> bool {
            match frame_result {
                Ok(Some(frame)) => events.send(PtyEvent::Frame(frame)).is_ok(),
                Ok(None) => true,
                Err(e) => {
                    eprintln!("ghostty session error: {e:#}");
                    true
                }
            }
        };

        while let Ok(msg) = session_rx.recv() {
            match msg {
                SessionMsg::Bytes(b) => {
                    if !emit_frame(session.feed(&b)) {
                        break;
                    }
                }
                SessionMsg::Scroll(delta) => {
                    if !emit_frame(session.scroll_viewport(delta)) {
                        break;
                    }
                }
                SessionMsg::Resize { cols, rows } => {
                    if let Err(e) = session.resize(cols, rows) {
                        eprintln!("ghostty resize error: {e:#}");
                    }
                }
                SessionMsg::Shutdown => break,
            }
        }

        reap(&child_for_reader);
        let _ = events.send(PtyEvent::Exit);
        let _ = tauri::Emitter::emit(
            &app_for_exit,
            "pty:exit",
            &serde_json::json!({ "rid": rid }),
        );
    });

    Ok(PtySpawned {
        rid,
        shell: shell_name,
    })
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
    let _ = handle
        .session_sender()
        .send(SessionMsg::Resize { cols, rows });
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
    let _ = handle.session_sender().send(SessionMsg::Shutdown);
    drop(handle);
    let _ = app.resources_table().close(rid);
    Ok(())
}

/// Internal helper for `input::pty_scroll` to push a scroll delta into the
/// session thread without touching the channel type publicly.
pub fn dispatch_scroll(handle: &PtyHandle, delta: isize) {
    let _ = handle.session_sender().send(SessionMsg::Scroll(delta));
}
