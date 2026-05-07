use std::io::{Read, Write};
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::State;
use tauri::ipc::Channel;

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

#[derive(Default)]
pub struct PtyState {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
}

fn hushlogin() -> bool {
    etcetera::home_dir()
        .map(|home| home.join(".hushlogin").exists())
        .unwrap_or(false)
}

fn build_command(shell: &str) -> Result<CommandBuilder> {
    let user = whoami::username().context("failed to read current username")?;
    let flags = if hushlogin() { "-flpq" } else { "-flp" };
    let mut cmd = CommandBuilder::new("/usr/bin/login");
    cmd.arg(flags);
    cmd.arg(user);
    cmd.arg("/bin/bash");
    cmd.arg("--noprofile");
    cmd.arg("--norc");
    cmd.arg("-c");
    cmd.arg(format!("exec -l {}", shell));
    Ok(cmd)
}

fn apply_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", env!("CARGO_PKG_NAME"));
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
    cmd.env("LANG", lang);
}

#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, PtyState>,
    events: Channel<PtyEvent>,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    if state.writer.lock().unwrap().is_some() {
        return Ok(());
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = build_command(&shell)?;
    apply_env(&mut cmd);

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

    *state.writer.lock().unwrap() = Some(writer);
    *state.master.lock().unwrap() = Some(pair.master);

    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
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

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, data: String) -> CommandResult<()> {
    let mut guard = state.writer.lock().unwrap();
    let writer = guard.as_mut().ok_or_else(|| anyhow!("pty not spawned"))?;
    writer
        .write_all(data.as_bytes())
        .context("failed to write to pty")?;
    writer.flush().context("failed to flush pty")?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, cols: u16, rows: u16) -> CommandResult<()> {
    let guard = state.master.lock().unwrap();
    let master = guard.as_ref().ok_or_else(|| anyhow!("pty not spawned"))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to resize pty")?;
    Ok(())
}
