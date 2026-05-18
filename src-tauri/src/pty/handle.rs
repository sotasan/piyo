use std::io::Write;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{MasterPty, PtySize};

use crate::vt;

pub(super) enum SessionMsg {
    Bytes(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    },
    Shutdown,
}

pub(super) type ChildHandle = Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;

pub struct PtyHandle {
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) writer: vt::PtyWriter,
    pub(super) child: ChildHandle,
    pub(super) session_tx: Mutex<Sender<SessionMsg>>,
}

impl tauri::Resource for PtyHandle {}

impl PtyHandle {
    fn send(&self, msg: SessionMsg) {
        let _ = self.session_tx.lock().unwrap().send(msg);
    }

    pub(super) fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("failed to write to pty")?;
        w.flush().context("failed to flush pty")?;
        Ok(())
    }

    pub(super) fn resize(&self, cols: u16, rows: u16, cw: u32, ch: u32) -> Result<()> {
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

    pub(super) fn shutdown(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
        self.send(SessionMsg::Shutdown);
    }
}
