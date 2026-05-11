//! Ghostty VT backend.
//!
//! [`Session`] owns a [`libghostty_vt::Terminal`] per PTY. Ghostty is the
//! authoritative VT parser on the Rust side: it tracks cursor, screen,
//! scrollback, title, modes, etc. State changes surface via ghostty's native
//! callbacks (`on_title_changed`, `on_pty_write`, ...), and the parsed grid
//! is shipped to the renderer as a [`Frame`] via the snapshot built from
//! [`libghostty_vt::render::RenderState`].
//!
//! Key and mouse encoding happen on the Tauri command thread using
//! [`libghostty_vt::key::Encoder`] / [`libghostty_vt::mouse::Encoder`].
//! Both are `!Send`, but a fresh local encoder per call is cheap; it pulls
//! the encoder-relevant modes from a thread-safe [`Modes`] cache that the
//! session refreshes after every `vt_write`.
//!
//! The terminal handle is `!Send`/`!Sync`, so the session must live on the
//! same thread as the PTY reader loop in [`crate::pty`].

use std::io::Write;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use libghostty_vt::{
    Terminal, TerminalOptions,
    key::KittyKeyFlags,
    render::{CellIterator, CursorVisualStyle, Dirty, RenderState, RowIterator, Snapshot},
    style::{RgbColor, Underline},
    terminal::Mode,
};
use tauri::{AppHandle, Emitter, ResourceId};

/// Shared handle to the PTY master writer. The ghostty `on_pty_write`
/// callback (DA / DSR responses) and the `pty_write` Tauri command for user
/// input both push through this.
pub type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Thread-safe snapshot of the terminal modes the key / mouse encoders need.
/// Refreshed after every `vt_write` so Tauri-thread encoders can configure
/// themselves without touching the `!Send` [`Terminal`].
#[derive(Clone, Copy, Debug, Default)]
pub struct Modes {
    pub cursor_key_application: bool,
    pub keypad_key_application: bool,
    pub alt_esc_prefix: bool,
    pub kitty_flags: u8,
    pub mouse_tracking: MouseTracking,
    pub mouse_format: MouseFormat,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseTracking {
    #[default]
    None,
    X10,
    Normal,
    Button,
    Any,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseFormat {
    #[default]
    X10,
    Utf8,
    Sgr,
    Urxvt,
    SgrPixels,
}

pub type SharedModes = Arc<Mutex<Modes>>;

const SCROLLBACK: usize = 5_000;

/// Serialised snapshot of the dirty parts of the terminal grid produced by
/// [`Session::feed`]. Mirrors the data exposed by
/// [`libghostty_vt::render::RenderState`] in a serde-friendly shape.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub cols: u16,
    pub rows: u16,
    pub background: [u8; 3],
    pub foreground: [u8; 3],
    /// When `true`, the renderer should clear and reapply every row in
    /// `dirty`. When `false`, only the listed rows changed.
    pub full: bool,
    pub cursor: Option<Cursor>,
    pub dirty: Vec<Row>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub x: u16,
    pub y: u16,
    pub blinking: bool,
    /// 0=block, 1=block_hollow, 2=underline, 3=bar.
    pub style: u8,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub y: u16,
    pub cells: Vec<Cell>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub text: String,
    pub fg: Option<[u8; 3]>,
    pub bg: Option<[u8; 3]>,
    /// Bit flags: 1=bold, 2=italic, 4=underline, 8=inverse, 16=faint,
    /// 32=strikethrough, 64=blink, 128=invisible.
    pub flags: u8,
}

const FLAG_BOLD: u8 = 1;
const FLAG_ITALIC: u8 = 2;
const FLAG_UNDERLINE: u8 = 4;
const FLAG_INVERSE: u8 = 8;
const FLAG_FAINT: u8 = 16;
const FLAG_STRIKETHROUGH: u8 = 32;
const FLAG_BLINK: u8 = 64;
const FLAG_INVISIBLE: u8 = 128;

/// A live ghostty parsing session bound to a single PTY.
pub struct Session {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iter: RowIterator<'static>,
    cell_iter: CellIterator<'static>,
    modes: SharedModes,
}

impl Session {
    /// Create a session, wiring pty-response output through `writer` and
    /// state-change events through the app emitter.
    pub fn new(
        cols: u16,
        rows: u16,
        writer: PtyWriter,
        modes: SharedModes,
        app: AppHandle,
        rid: ResourceId,
    ) -> Result<Self> {
        let mut terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: SCROLLBACK,
        })
        .context("ghostty terminal init failed")?;

        terminal
            .on_pty_write(move |_term, data| {
                if let Ok(mut w) = writer.lock() {
                    let _ = w.write_all(data);
                    let _ = w.flush();
                }
            })
            .context("registering on_pty_write failed")?
            .on_title_changed(move |term| {
                let title = term.title().unwrap_or_default().to_owned();
                let _ = app.emit(
                    "pty:title",
                    serde_json::json!({ "rid": rid, "title": title }),
                );
            })
            .context("registering on_title_changed failed")?;

        let me = Self {
            terminal,
            render_state: RenderState::new().context("render state init failed")?,
            row_iter: RowIterator::new().context("row iterator init failed")?,
            cell_iter: CellIterator::new().context("cell iterator init failed")?,
            modes,
        };
        me.refresh_modes();
        Ok(me)
    }

    /// Feed PTY output into ghostty and produce a frame for the renderer.
    /// Returns `None` when the snapshot is clean (nothing changed).
    pub fn feed(&mut self, data: &[u8]) -> Result<Option<Frame>> {
        self.terminal.vt_write(data);
        self.refresh_modes();
        self.snapshot()
    }

    /// Mirror a window resize from the frontend into the ghostty grid.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.terminal
            .resize(cols, rows, 0, 0)
            .context("ghostty terminal resize failed")?;
        Ok(())
    }

    /// Scroll ghostty's viewport by `delta` rows (negative scrolls up into
    /// history) and produce a fresh frame reflecting the new view.
    pub fn scroll_viewport(&mut self, delta: isize) -> Result<Option<Frame>> {
        use libghostty_vt::terminal::ScrollViewport;
        self.terminal.scroll_viewport(ScrollViewport::Delta(delta));
        self.snapshot()
    }

    fn refresh_modes(&self) {
        let term = &self.terminal;
        let mut m = self.modes.lock().unwrap();
        m.cursor_key_application = term.mode(Mode::DECCKM).unwrap_or(false);
        m.keypad_key_application = term.mode(Mode::KEYPAD_KEYS).unwrap_or(false);
        m.alt_esc_prefix = term.mode(Mode::ALT_ESC_PREFIX).unwrap_or(false);
        m.kitty_flags = term
            .kitty_keyboard_flags()
            .unwrap_or(KittyKeyFlags::DISABLED)
            .bits();
        m.mouse_tracking = if term.mode(Mode::ANY_MOUSE).unwrap_or(false) {
            MouseTracking::Any
        } else if term.mode(Mode::BUTTON_MOUSE).unwrap_or(false) {
            MouseTracking::Button
        } else if term.mode(Mode::NORMAL_MOUSE).unwrap_or(false) {
            MouseTracking::Normal
        } else if term.mode(Mode::X10_MOUSE).unwrap_or(false) {
            MouseTracking::X10
        } else {
            MouseTracking::None
        };
        m.mouse_format = if term.mode(Mode::SGR_PIXELS_MOUSE).unwrap_or(false) {
            MouseFormat::SgrPixels
        } else if term.mode(Mode::URXVT_MOUSE).unwrap_or(false) {
            MouseFormat::Urxvt
        } else if term.mode(Mode::SGR_MOUSE).unwrap_or(false) {
            MouseFormat::Sgr
        } else if term.mode(Mode::UTF8_MOUSE).unwrap_or(false) {
            MouseFormat::Utf8
        } else {
            MouseFormat::X10
        };
    }

    fn snapshot(&mut self) -> Result<Option<Frame>> {
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
        let rows = snap.rows().context("reading rows failed")?;
        let colors = snap.colors().context("reading colors failed")?;
        let cursor = read_cursor(&snap)?;

        let mut dirty = Vec::new();
        let mut rows_iter = self
            .row_iter
            .update(&snap)
            .context("updating row iterator failed")?;
        let mut y: u16 = 0;
        while let Some(row) = rows_iter.next() {
            let row_dirty = row.dirty().context("reading row dirty failed")?;
            if row_dirty || full {
                let mut cells = Vec::with_capacity(cols as usize);
                let mut cell_it = self
                    .cell_iter
                    .update(row)
                    .context("updating cell iterator failed")?;
                while let Some(cell) = cell_it.next() {
                    cells.push(build_cell(cell)?);
                }
                dirty.push(Row { y, cells });
                row.set_dirty(false).ok();
            }
            y += 1;
        }

        snap.set_dirty(Dirty::Clean).ok();

        Ok(Some(Frame {
            cols,
            rows,
            background: rgb(colors.background),
            foreground: rgb(colors.foreground),
            full,
            cursor,
            dirty,
        }))
    }
}

fn read_cursor(snap: &Snapshot<'_, '_>) -> Result<Option<Cursor>> {
    if !snap.cursor_visible().context("cursor_visible failed")? {
        return Ok(None);
    }
    let Some(vp) = snap.cursor_viewport().context("cursor_viewport failed")? else {
        return Ok(None);
    };
    let style = match snap
        .cursor_visual_style()
        .context("cursor_visual_style failed")?
    {
        CursorVisualStyle::Block => 0,
        CursorVisualStyle::BlockHollow => 1,
        CursorVisualStyle::Underline => 2,
        CursorVisualStyle::Bar => 3,
        _ => 0,
    };
    Ok(Some(Cursor {
        x: vp.x,
        y: vp.y,
        blinking: snap.cursor_blinking().context("cursor_blinking failed")?,
        style,
    }))
}

fn build_cell(cell: &libghostty_vt::render::CellIteration<'_, '_>) -> Result<Cell> {
    let len = cell.graphemes_len().context("graphemes_len failed")?;
    let text = if len == 0 {
        String::new()
    } else {
        cell.graphemes()
            .context("graphemes failed")?
            .into_iter()
            .collect()
    };
    let fg = cell.fg_color().context("fg_color failed")?.map(rgb);
    let bg = cell.bg_color().context("bg_color failed")?.map(rgb);
    let style = cell.style().context("style failed")?;

    let mut flags = 0u8;
    if style.bold {
        flags |= FLAG_BOLD;
    }
    if style.italic {
        flags |= FLAG_ITALIC;
    }
    if !matches!(style.underline, Underline::None) {
        flags |= FLAG_UNDERLINE;
    }
    if style.inverse {
        flags |= FLAG_INVERSE;
    }
    if style.faint {
        flags |= FLAG_FAINT;
    }
    if style.strikethrough {
        flags |= FLAG_STRIKETHROUGH;
    }
    if style.blink {
        flags |= FLAG_BLINK;
    }
    if style.invisible {
        flags |= FLAG_INVISIBLE;
    }

    Ok(Cell {
        text,
        fg,
        bg,
        flags,
    })
}

fn rgb(c: RgbColor) -> [u8; 3] {
    [c.r, c.g, c.b]
}
