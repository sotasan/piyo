//! PTY ownership, IPC commands, and ghostty session orchestration.
//!
//! Submodules:
//! - [`types`]: wire DTOs and IPC event names.
//! - [`handle`]: [`PtyHandle`] resource.

mod handle;
mod types;

use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use portable_pty::{PtySize, native_pty_system};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};

use crate::osc::OscPerformer;
use crate::shell::{self, ResourceDirs, Shell};
use crate::vt::{self, Session};
use crate::wire;

pub use handle::PtyHandle;
use handle::{ChildHandle, SessionMsg};
use types::{CommandResult, EVENT_PTY_EXIT, PtyExit, PtySpawned};
pub use types::{EVENT_PTY_CWD, PtyCwd};

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

    let (session_tx, session_rx) = std::sync::mpsc::channel::<SessionMsg>();
    let session_tx_for_reader = session_tx.clone();

    let handle = PtyHandle {
        master: Mutex::new(pair.master),
        writer,
        child,
        session_tx: Mutex::new(session_tx),
    };

    let rid = app.resources_table().add(handle);

    // Reader thread: pulls bytes from the PTY, taps OSC dispatches, and
    // hands each chunk to the vt session for cell parsing and forwarding.
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
        reap(&child_for_reader);
        let _ = session_tx_for_reader.send(SessionMsg::Shutdown);
    });

    // Session thread: owns the !Send libghostty Terminal. Receives byte
    // chunks, forwards them verbatim to xterm.js as KIND_BYTES messages,
    // then ships a KIND_FRAME with ghostty's cell snapshot. Ordering is
    // preserved because both messages leave the same thread.
    let events_clone = events.clone();
    let app_for_session = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut session = match Session::new(cols, rows) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("vt session init failed: {e:#}");
                return;
            }
        };
        while let Ok(msg) = session_rx.recv() {
            match msg {
                SessionMsg::Bytes(chunk) => {
                    if events_clone
                        .send(InvokeResponseBody::Raw(wire::bytes_event(&chunk)))
                        .is_err()
                    {
                        break;
                    }
                    match session.feed(&chunk) {
                        Ok(Some(frame)) => {
                            if events_clone.send(InvokeResponseBody::Raw(frame)).is_err() {
                                break;
                            }
                        }
                        Ok(None) => {}
                        Err(e) => {
                            tracing::warn!("vt feed failed: {e:#}");
                        }
                    }
                }
                SessionMsg::Resize {
                    cols,
                    rows,
                    cell_width_px,
                    cell_height_px,
                } => {
                    if let Err(e) = session.resize(cols, rows, cell_width_px, cell_height_px) {
                        tracing::warn!("vt resize failed: {e:#}");
                    }
                }
                SessionMsg::Shutdown => break,
            }
        }
        let _ = events_clone.send(InvokeResponseBody::Raw(wire::exit_event()));
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
    cell_width: u32,
    cell_height: u32,
) -> CommandResult<()> {
    handle(&app, rid)?.resize(cols, rows, cell_width, cell_height)?;
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

fn handle(app: &AppHandle, rid: u32) -> CommandResult<Arc<PtyHandle>> {
    Ok(app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?)
}

fn reap(child: &ChildHandle) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}
