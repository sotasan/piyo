//! PTY ownership, IPC commands, and ghostty session orchestration.
//!
//! Submodules:
//! - [`types`]: wire DTOs and IPC event names.
//! - [`handle`]: [`PtyHandle`] resource and its key/mouse encoding.
//! - [`listeners`]: emit listeners bridging ghostty callbacks to Tauri events.

mod handle;
mod listeners;
mod types;

use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{PtySize, native_pty_system};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};

use crate::osc::OscPerformer;
use crate::shell::{self, ResourceDirs, Shell};
use crate::vt::{self, Session};
use crate::wire;

pub use handle::PtyHandle;
use handle::{ChildHandle, SessionMsg};
use listeners::{BellEmit, ModeEmit, TitleEmit};
use types::{CommandResult, EVENT_PTY_EXIT, PtyExit, PtySpawned};
pub use types::{EVENT_PTY_CWD, KeyInput, MouseEventInput, PtyCwd};

const READ_BUF_SIZE: usize = 4096;

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    events: Channel<InvokeResponseBody>,
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

    let shell_path = shell::resolve_path();
    let shell_name = Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_string();
    let detected = Shell::detect(&shell_path);
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve resource dir")?;
    let dirs = ResourceDirs::from_resource_dir(&resource_dir);
    let cwd_path = cwd.as_ref().map(Path::new).filter(|p| p.is_dir());
    let cmd = shell::build_command(&shell_path, &detected, &dirs, cwd_path)?;

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

    let app_for_session = app.clone();
    std::thread::spawn(move || {
        let mode_listener = ModeEmit {
            app: app_for_session.clone(),
            rid,
        };
        let title_listener = TitleEmit {
            app: app_for_session.clone(),
            rid,
        };
        let bell_listener = BellEmit {
            app: app_for_session.clone(),
            rid,
        };
        let mut session = match Session::new(
            cols,
            rows,
            writer_for_vt,
            modes_for_vt,
            mode_listener,
            title_listener,
            bell_listener,
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "ghostty vt session init failed");
                return;
            }
        };

        let emit_frame = |bytes: Result<Option<Vec<u8>>>| -> bool {
            match bytes {
                Ok(Some(b)) => events.send(InvokeResponseBody::Raw(b)).is_ok(),
                Ok(None) => true,
                Err(e) => {
                    tracing::error!(error = %e, "ghostty session error");
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
                SessionMsg::Resize {
                    cols,
                    rows,
                    cell_width_px,
                    cell_height_px,
                } => {
                    if let Err(e) = session.resize(cols, rows, cell_width_px, cell_height_px) {
                        tracing::error!(error = %e, "ghostty resize error");
                    }
                }
                SessionMsg::Shutdown => break,
            }
        }

        reap(&child_for_reader);
        let _ = events.send(InvokeResponseBody::Raw(wire::exit_event()));
        let _ = app_for_session.emit(EVENT_PTY_EXIT, PtyExit { rid });
    });

    Ok(PtySpawned {
        rid,
        shell: shell_name,
    })
}

#[tauri::command]
pub fn pty_write(app: AppHandle, rid: u32, data: String) -> CommandResult<()> {
    handle(&app, rid)?.write(data.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    app: AppHandle,
    rid: u32,
    cols: u16,
    rows: u16,
    cell_width: Option<u32>,
    cell_height: Option<u32>,
) -> CommandResult<()> {
    handle(&app, rid)?.resize(
        cols,
        rows,
        cell_width.unwrap_or(0),
        cell_height.unwrap_or(0),
    )?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(app: AppHandle, rid: u32) -> CommandResult<()> {
    let Ok(h) = app.resources_table().get::<PtyHandle>(rid) else {
        return Ok(());
    };
    h.shutdown();
    drop(h);
    let _ = app.resources_table().close(rid);
    Ok(())
}

#[tauri::command]
pub fn pty_send_key(app: AppHandle, rid: u32, input: KeyInput) -> CommandResult<()> {
    handle(&app, rid)?.send_key(input)?;
    Ok(())
}

#[tauri::command]
pub fn pty_send_mouse(app: AppHandle, rid: u32, input: MouseEventInput) -> CommandResult<()> {
    handle(&app, rid)?.send_mouse(input)?;
    Ok(())
}

fn handle(app: &AppHandle, rid: u32) -> CommandResult<Arc<PtyHandle>> {
    Ok(app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?)
}

fn reap(child: &ChildHandle) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.wait();
    }
}
