//! Ghostty VT backend.
//!
//! [`Session`] owns a [`libghostty_vt::Terminal`] per PTY. Ghostty is the
//! authoritative VT parser: it tracks cursor, screen, scrollback, title and
//! modes. State changes surface via ghostty's native callbacks
//! (`on_title_changed`, `on_pty_write`, …), and the parsed grid is shipped
//! to the renderer as a packed binary blob built by [`crate::wire`].
//!
//! Key and mouse encoding happen on the Tauri command thread using
//! [`libghostty_vt::key::Encoder`] / [`libghostty_vt::mouse::Encoder`].
//! Both are `!Send`, but a fresh local encoder per call is cheap; it pulls
//! the encoder-relevant modes from a thread-safe [`Modes`] cache that the
//! session refreshes after every `vt_write`.

mod decode;
mod modes;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use libghostty_vt::{
    Terminal, TerminalOptions,
    key::KittyKeyFlags,
    kitty::graphics::{PlacementIterator, set_png_decoder},
    render::{CellIterator, Dirty, RenderState, RowIterator},
    terminal::Mode,
};

use crate::wire::{self, Cell, FrameBuf};
use decode::{PngDecoder, read_cursor, read_graphemes, to_rgba};

pub use modes::{
    BellListener, ModeListener, Modes, MouseFormat, MouseTracking, SharedModes, TitleListener,
};

/// Shared handle to the PTY master writer. The ghostty `on_pty_write`
/// callback (DA / DSR responses) and the `pty_write` Tauri command for user
/// input both push through this.
pub type PtyWriter = Arc<Mutex<Box<dyn std::io::Write + Send>>>;

const SCROLLBACK: usize = 5_000;
/// Per-session ceiling on libghostty-vt's kitty graphics image store.
const KITTY_STORAGE_LIMIT: u64 = 64 * 1024 * 1024;

/// A live ghostty parsing session bound to a single PTY.
pub struct Session {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iter: RowIterator<'static>,
    cell_iter: CellIterator<'static>,
    placement_iter: PlacementIterator<'static>,
    shipped_images: HashSet<u32>,
    modes: SharedModes,
    mode_listener: Box<dyn ModeListener>,
    /// Last seen scrollback-row count; diff against `terminal.scrollback_rows()`
    /// each frame to find which rows just fell off the active screen.
    last_scrollback_rows: usize,
}

impl Session {
    pub fn new(
        cols: u16,
        rows: u16,
        writer: PtyWriter,
        modes: SharedModes,
        mode_listener: impl ModeListener,
        title_listener: impl TitleListener,
        bell_listener: impl BellListener,
    ) -> Result<Self> {
        // libghostty-vt's PNG decoder slot is thread-local; install ours.
        let _ = set_png_decoder(Some(Box::new(PngDecoder)));

        let mut terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: SCROLLBACK,
        })
        .context("ghostty terminal init failed")?;

        terminal
            .set_kitty_image_storage_limit(KITTY_STORAGE_LIMIT)
            .context("setting kitty image storage limit failed")?;

        terminal
            .on_pty_write(move |_term, data| {
                if let Ok(mut w) = writer.lock() {
                    use std::io::Write;
                    let _ = w.write_all(data);
                    let _ = w.flush();
                }
            })
            .context("registering on_pty_write failed")?
            .on_title_changed(move |term| {
                let title = term.title().unwrap_or_default();
                title_listener.on_title(title);
            })
            .context("registering on_title_changed failed")?
            .on_bell(move |_term| bell_listener.on_bell())
            .context("registering on_bell failed")?;

        let me = Self {
            terminal,
            render_state: RenderState::new().context("render state init failed")?,
            row_iter: RowIterator::new().context("row iterator init failed")?,
            cell_iter: CellIterator::new().context("cell iterator init failed")?,
            placement_iter: PlacementIterator::new().context("placement iterator init failed")?,
            shipped_images: HashSet::new(),
            modes,
            mode_listener: Box::new(mode_listener),
            last_scrollback_rows: 0,
        };
        me.refresh_modes();
        Ok(me)
    }

    /// Feed PTY output into ghostty and produce a packed binary frame for
    /// the renderer. Returns `None` when the snapshot is clean.
    pub fn feed(&mut self, data: &[u8]) -> Result<Option<Vec<u8>>> {
        self.terminal.vt_write(data);
        self.refresh_modes();
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

    fn refresh_modes(&self) {
        let term = &self.terminal;
        let snapshot = Modes {
            cursor_key_application: term.mode(Mode::DECCKM).unwrap_or(false),
            keypad_key_application: term.mode(Mode::KEYPAD_KEYS).unwrap_or(false),
            alt_esc_prefix: term.mode(Mode::ALT_ESC_PREFIX).unwrap_or(false),
            kitty_flags: term
                .kitty_keyboard_flags()
                .unwrap_or(KittyKeyFlags::DISABLED)
                .bits(),
            mouse_tracking: if term.mode(Mode::ANY_MOUSE).unwrap_or(false) {
                MouseTracking::Any
            } else if term.mode(Mode::BUTTON_MOUSE).unwrap_or(false) {
                MouseTracking::Button
            } else if term.mode(Mode::NORMAL_MOUSE).unwrap_or(false) {
                MouseTracking::Normal
            } else if term.mode(Mode::X10_MOUSE).unwrap_or(false) {
                MouseTracking::X10
            } else {
                MouseTracking::None
            },
            mouse_format: if term.mode(Mode::SGR_PIXELS_MOUSE).unwrap_or(false) {
                MouseFormat::SgrPixels
            } else if term.mode(Mode::URXVT_MOUSE).unwrap_or(false) {
                MouseFormat::Urxvt
            } else if term.mode(Mode::SGR_MOUSE).unwrap_or(false) {
                MouseFormat::Sgr
            } else if term.mode(Mode::UTF8_MOUSE).unwrap_or(false) {
                MouseFormat::Utf8
            } else {
                MouseFormat::X10
            },
            bracketed_paste: term.mode(Mode::BRACKETED_PASTE).unwrap_or(false),
            focus_event: term.mode(Mode::FOCUS_EVENT).unwrap_or(false),
        };
        let changed = {
            let mut prev = self.modes.lock().unwrap();
            let changed = *prev != snapshot;
            *prev = snapshot;
            changed
        };
        if changed {
            self.mode_listener.on_modes(&snapshot);
        }
    }

    fn snapshot(&mut self) -> Result<Option<Vec<u8>>> {
        let scrollback_rows = self.terminal.scrollback_rows().unwrap_or(0);
        let delta = scrollback_rows.saturating_sub(self.last_scrollback_rows);

        let snap = self
            .render_state
            .update(&self.terminal)
            .context("render state update failed")?;
        let dirty_state = snap.dirty().context("reading dirty state failed")?;
        if matches!(dirty_state, Dirty::Clean) && delta == 0 {
            return Ok(None);
        }
        let full = matches!(dirty_state, Dirty::Full);
        let cols = snap.cols().context("reading cols failed")?;
        let rows = snap.rows().context("reading rows failed")?;
        let colors = snap.colors().context("reading colors failed")?;
        let cursor = read_cursor(&snap)?;

        let mut buf = FrameBuf::new(
            cols,
            rows,
            full,
            cursor,
            colors.background,
            colors.foreground,
        );
        if delta > 0 {
            buf.set_scrollback_promotions(u32::try_from(delta).unwrap_or(u32::MAX));
            self.last_scrollback_rows = scrollback_rows;
        }

        // Bind cell_iter to a local so the borrow checker sees it as
        // disjoint from `row_iter` and `render_state` (which `snap` holds).
        // libghostty-vt's Snapshot::set / RowIteration::set helpers take the
        // address of their `&T` parameter instead of the T, so set_dirty
        // corrupts the C-side state and the next dirty() read fails. Skip
        // resetting; update() recomputes dirty bits. Present as of 2026-05-14.
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
                        let style = cell.style().context("style failed")?;
                        let fg = cell.fg_color().context("fg_color failed")?;
                        let bg = cell.bg_color().context("bg_color failed")?;
                        buf.push_active_cell(
                            y,
                            x,
                            &Cell {
                                codepoint,
                                flags: wire::cell_flags(&style),
                                fg,
                                bg,
                            },
                            &extras,
                        );
                        x += 1;
                    }
                }
                y += 1;
            }
        }
        self.collect_kitty_graphics(&mut buf)?;
        Ok(Some(buf.finish()))
    }

    fn collect_kitty_graphics(&mut self, buf: &mut FrameBuf) -> Result<()> {
        let graphics = self
            .terminal
            .kitty_graphics()
            .context("kitty_graphics handle failed")?;
        let mut placement_it = self
            .placement_iter
            .update(&graphics)
            .context("placement iterator update failed")?;
        while let Some(p) = placement_it.next() {
            let image_id = p.image_id().context("placement image_id failed")?;
            let Some(image) = graphics.image(image_id) else {
                continue;
            };
            let info = p
                .placement_render_info(&image, &self.terminal)
                .context("placement_render_info failed")?;
            if !info.viewport_visible {
                continue;
            }
            buf.push_placement(
                image_id,
                p.placement_id().context("placement_id failed")?,
                p.z().context("placement z failed")?,
                info.viewport_col,
                info.viewport_row,
                info.pixel_width,
                info.pixel_height,
                info.source_x,
                info.source_y,
                info.source_width,
                info.source_height,
            );

            if self.shipped_images.insert(image_id) {
                let width = image.width().context("image width failed")?;
                let height = image.height().context("image height failed")?;
                let format = image.format().context("image format failed")?;
                let raw = image.data().context("image data failed")?;
                if let Some(rgba) = to_rgba(raw, format, width, height) {
                    buf.push_image(image_id, width, height, &rgba);
                }
            }
        }
        Ok(())
    }
}
