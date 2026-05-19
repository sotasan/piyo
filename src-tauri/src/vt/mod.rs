//! Ghostty VT backend (cells + cursor only).
//!
//! [`Session`] owns a [`libghostty_vt::Terminal`] per PTY. Ghostty parses
//! the byte stream and tracks the cell grid, cursor, and scrollback.
//! Every chunk produces a packed binary frame that the renderer pushes
//! into xterm.js's buffer via the JS-side internals shim.
//!
//! Modes, OSC dispatch, kitty keyboard, APC graphics, title, and bell all
//! stay with xterm.js — the same PTY bytes are forwarded to its parser
//! alongside the frame stream, so its native handling keeps working.

mod decode;

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use libghostty_vt::{
    Terminal, TerminalOptions,
    render::{CellIterator, Dirty, RenderState, RowIterator},
};

use crate::wire::FrameBuf;
use decode::{read_cursor, read_graphemes};

/// Shared handle to the PTY master writer. Ghostty's `on_pty_write`
/// callback (DA / DSR responses) pushes through this.
pub type PtyWriter = Arc<Mutex<Box<dyn std::io::Write + Send>>>;

const SCROLLBACK: usize = 5_000;

/// A live ghostty parsing session bound to a single PTY.
pub struct Session {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iter: RowIterator<'static>,
    cell_iter: CellIterator<'static>,
}

impl Session {
    pub fn new(cols: u16, rows: u16) -> Result<Self> {
        let terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: SCROLLBACK,
        })
        .context("ghostty terminal init failed")?;

        // No `on_pty_write` callback: xterm.js's parser receives the same
        // byte stream and answers DA / DSR / kitty-keyboard queries itself.
        // If ghostty answered too, apps like vim would receive each reply
        // twice — the duplicate falls through vim's response parser and
        // gets treated as keystrokes (e.g. a stray `y` enters
        // operator-pending mode).

        Ok(Self {
            terminal,
            render_state: RenderState::new().context("render state init failed")?,
            row_iter: RowIterator::new().context("row iterator init failed")?,
            cell_iter: CellIterator::new().context("cell iterator init failed")?,
        })
    }

    /// Feed PTY output into ghostty and produce a packed binary frame.
    /// Returns `None` when the snapshot is clean.
    pub fn feed(&mut self, data: &[u8]) -> Result<Option<Vec<u8>>> {
        self.terminal.vt_write(data);
        self.snapshot()
    }

    pub fn resize(
        &mut self,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> Result<()> {
        self.terminal
            .resize(cols, rows, cell_width_px, cell_height_px)
            .context("ghostty terminal resize failed")?;
        Ok(())
    }

    fn snapshot(&mut self) -> Result<Option<Vec<u8>>> {
        let snap = self
            .render_state
            .update(&self.terminal)
            .context("render state update failed")?;
        let dirty_state = snap.dirty().context("reading dirty state failed")?;
        if matches!(dirty_state, Dirty::Clean) {
            return Ok(None);
        }
        let full = matches!(dirty_state, Dirty::Full);
        let cols = snap.cols().context("reading cols failed")?;
        let cursor = read_cursor(&snap)?;

        let mut buf = FrameBuf::new(full, cursor);

        // Bind cell_iter to a local so the borrow checker sees it as
        // disjoint from `row_iter` and `render_state` (which `snap` holds).
        // libghostty-vt's Snapshot::set / RowIteration::set helpers take the
        // address of their `&T` parameter instead of the T, so set_dirty
        // corrupts the C-side state and the next dirty() read fails. Skip
        // resetting; update() recomputes dirty bits.
        {
            let cell_iter = &mut self.cell_iter;
            let mut rows_iter = self
                .row_iter
                .update(&snap)
                .context("updating row iterator failed")?;
            let mut y: u16 = 0;
            while let Some(row) = rows_iter.next() {
                let row_dirty = row.dirty().context("reading row dirty failed")?;
                if row_dirty || full {
                    buf.start_active_row(y, cols);
                    let mut cell_it = cell_iter
                        .update(row)
                        .context("updating cell iterator failed")?;
                    let mut x: u16 = 0;
                    while let Some(cell) = cell_it.next() {
                        let (codepoint, extras) = read_graphemes(cell)?;
                        buf.push_active_cell(y, x, codepoint, &extras);
                        x += 1;
                    }
                }
                y += 1;
            }
        }
        Ok(Some(buf.finish()))
    }
}
