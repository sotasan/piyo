use std::io::Write;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use portable_pty::{MasterPty, PtySize};

pub(super) type ChildHandle = Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;
pub(super) type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

pub struct PtyHandle {
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) writer: PtyWriter,
    pub(super) child: ChildHandle,
}

impl tauri::Resource for PtyHandle {}

impl PtyHandle {
    pub(super) fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("failed to write to pty")?;
        w.flush().context("failed to flush pty")?;
        Ok(())
    }

    pub(super) fn resize(&self, cols: u16, rows: u16, cell_width: u32, cell_height: u32) -> Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: u16::try_from(cell_width.saturating_mul(u32::from(cols)))
                    .unwrap_or(u16::MAX),
                pixel_height: u16::try_from(cell_height.saturating_mul(u32::from(rows)))
                    .unwrap_or(u16::MAX),
            })
            .context("failed to resize pty")?;
        Ok(())
    }

    pub(super) fn shutdown(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }
}
