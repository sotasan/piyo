//! PTY ownership, IPC commands, and ghostty session orchestration.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};

use crate::osc::OscPerformer;
use crate::shell::{self, ResourceDirs, Shell};
use crate::vt::{self, Session};
use crate::wire;

pub const EVENT_PTY_CWD: &str = "pty:cwd";
pub const EVENT_PTY_EXIT: &str = "pty:exit";

const READ_BUF_SIZE: usize = 4096;

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCwd {
    pub rid: u32,
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    rid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub rid: u32,
    pub shell: String,
}

enum SessionMsg {
    Bytes {
        data: Vec<u8>,
        /// Monotonic counter assigned by the reader thread. The session
        /// thread drops any chunk whose `seq` is below the interrupt
        /// cutoff (set by `pty_write` when it sees a `\x03`), so a
        /// Ctrl+C against a flooding command (e.g. `tree /`) discards
        /// the pre-Ctrl+C backlog instead of crawling it across the
        /// screen.
        seq: u64,
    },
    Resize {
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    },
    Shutdown,
}

type ChildHandle = Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;

pub struct PtyHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: vt::PtyWriter,
    child: ChildHandle,
    session_tx: Mutex<Sender<SessionMsg>>,
    /// Next `seq` the reader will stamp on outgoing chunks.
    reader_seq: Arc<AtomicU64>,
    /// Cutoff: session thread drops `Bytes` whose `seq` <= this.
    interrupt_seq: Arc<AtomicU64>,
}

impl tauri::Resource for PtyHandle {}

impl PtyHandle {
    fn send(&self, msg: SessionMsg) {
        let _ = self.session_tx.lock().unwrap().send(msg);
    }

    fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("failed to write to pty")?;
        w.flush().context("failed to flush pty")?;
        // If the user just sent Ctrl+C, mark every chunk the reader has
        // already enqueued (and the one it might be about to enqueue) as
        // discardable. The session thread will skip forwarding them to
        // JS, so the post-SIGINT drain doesn't crawl across the screen.
        if data.contains(&0x03) {
            let cutoff = self.reader_seq.load(Ordering::Relaxed);
            self.interrupt_seq.store(cutoff, Ordering::Relaxed);
        }
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16, cw: u32, ch: u32) -> Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: u16::try_from(cw.saturating_mul(u32::from(cols))).unwrap_or(u16::MAX),
                pixel_height: u16::try_from(ch.saturating_mul(u32::from(rows))).unwrap_or(u16::MAX),
            })
            .context("failed to resize pty")?;
        self.send(SessionMsg::Resize {
            cols,
            rows,
            cell_width_px: cw,
            cell_height_px: ch,
        });
        Ok(())
    }

    fn shutdown(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
        self.send(SessionMsg::Shutdown);
    }
}

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

    let reader_seq = Arc::new(AtomicU64::new(0));
    let interrupt_seq = Arc::new(AtomicU64::new(0));
    let reader_seq_for_reader = reader_seq.clone();
    let interrupt_seq_for_session = interrupt_seq.clone();

    let handle = PtyHandle {
        master: Mutex::new(pair.master),
        writer,
        child,
        session_tx: Mutex::new(session_tx),
        reader_seq,
        interrupt_seq,
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
                    let seq = reader_seq_for_reader.fetch_add(1, Ordering::Relaxed) + 1;
                    if session_tx_for_reader
                        .send(SessionMsg::Bytes {
                            data: chunk.to_vec(),
                            seq,
                        })
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
                SessionMsg::Bytes { data: chunk, seq } => {
                    // Drop chunks queued before the most recent Ctrl+C.
                    // Ghostty doesn't see them either; on the next chunk
                    // it'll mark everything dirty (Dirty::Full) and the
                    // re-paint will catch up.
                    if seq <= interrupt_seq_for_session.load(Ordering::Relaxed) {
                        continue;
                    }
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
