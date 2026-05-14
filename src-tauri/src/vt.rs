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

use std::collections::HashSet;
use std::io::Write;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use libghostty_vt::{
    Terminal, TerminalOptions,
    alloc::{Allocator, Bytes},
    key::KittyKeyFlags,
    kitty::graphics::{DecodePng, DecodedImage, ImageFormat, PlacementIterator, set_png_decoder},
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
/// Per-session ceiling on libghostty-vt's kitty graphics image store.
const KITTY_STORAGE_LIMIT: u64 = 64 * 1024 * 1024;

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
    /// Kitty graphics images that the frontend hasn't seen yet. Each entry's
    /// `rgba` is base64-encoded 8-bit RGBA, decoded by libghostty-vt from
    /// the source PNG via `RustPngDecoder`.
    pub images: Vec<ImageData>,
    /// Visible kitty graphics placements for this snapshot. Reference
    /// images by `image_id`; the frontend keeps a cache keyed by id.
    pub placements: Vec<Placement>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub rgba: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub image_id: u32,
    pub placement_id: u32,
    pub viewport_col: i32,
    pub viewport_row: i32,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub source_x: u32,
    pub source_y: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub z: i32,
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
    placement_iter: PlacementIterator<'static>,
    /// Image ids whose pixel data has already been shipped to the frontend.
    /// The frontend caches images by id, so we only re-send pixels on first
    /// sighting per session.
    shipped_images: HashSet<u32>,
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
        // libghostty-vt's PNG decoder slot is thread-local, so each session
        // thread installs its own. Ignore "already set" errors when the same
        // thread spawns multiple sessions (currently it never does).
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
            placement_iter: PlacementIterator::new().context("placement iterator init failed")?,
            shipped_images: HashSet::new(),
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
    /// `cell_width_px` / `cell_height_px` are needed by libghostty-vt so kitty
    /// graphics placements can resolve their grid sizes into pixel dimensions
    /// (`placement_render_info().pixel_width` is zero without them).
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
        // libghostty-vt's Snapshot::set / RowIteration::set helpers take the
        // address of their `&T` parameter instead of the T, so set_dirty writes
        // pointer bytes into the C-side state — the next dirty() read fails as
        // InvalidValue. Skip resetting dirty and rely on the next update() to
        // recompute it. Still present on master as of 2026-05-14.
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
            }
            y += 1;
        }
        let (images, placements) = self.collect_kitty_graphics()?;

        Ok(Some(Frame {
            cols,
            rows,
            background: rgb(colors.background),
            foreground: rgb(colors.foreground),
            full,
            cursor,
            dirty,
            images,
            placements,
        }))
    }

    /// Walk libghostty-vt's kitty graphics placement list and convert it into
    /// frame-shippable shape. Pixel data is base64-encoded RGBA and only
    /// included for image ids the frontend hasn't seen this session.
    fn collect_kitty_graphics(&mut self) -> Result<(Vec<ImageData>, Vec<Placement>)> {
        let graphics = self
            .terminal
            .kitty_graphics()
            .context("kitty_graphics handle failed")?;
        let mut placement_it = self
            .placement_iter
            .update(&graphics)
            .context("placement iterator update failed")?;
        let mut images = Vec::new();
        let mut placements = Vec::new();
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
            placements.push(Placement {
                image_id,
                placement_id: p.placement_id().context("placement_id failed")?,
                viewport_col: info.viewport_col,
                viewport_row: info.viewport_row,
                pixel_width: info.pixel_width,
                pixel_height: info.pixel_height,
                source_x: info.source_x,
                source_y: info.source_y,
                source_width: info.source_width,
                source_height: info.source_height,
                z: p.z().context("placement z failed")?,
            });

            if self.shipped_images.insert(image_id) {
                let width = image.width().context("image width failed")?;
                let height = image.height().context("image height failed")?;
                let format = image.format().context("image format failed")?;
                let raw = image.data().context("image data failed")?;
                if let Some(rgba) = to_rgba(raw, format, width, height) {
                    images.push(ImageData {
                        id: image_id,
                        width,
                        height,
                        rgba: BASE64.encode(&rgba),
                    });
                }
            }
        }
        Ok((images, placements))
    }
}

/// Convert a kitty graphics pixel buffer to 8-bit RGBA. Returns `None` for
/// formats we don't handle (currently only PNG, which the decoder upstream
/// already turns into RGBA before storage).
fn to_rgba(raw: &[u8], format: ImageFormat, width: u32, height: u32) -> Option<Vec<u8>> {
    let pixels = (width as usize).checked_mul(height as usize)?;
    match format {
        ImageFormat::Rgba => Some(raw.to_vec()),
        ImageFormat::Rgb => {
            let mut out = Vec::with_capacity(pixels * 4);
            for chunk in raw.chunks_exact(3) {
                out.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]);
            }
            Some(out)
        }
        ImageFormat::GrayAlpha => {
            let mut out = Vec::with_capacity(pixels * 4);
            for chunk in raw.chunks_exact(2) {
                out.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]);
            }
            Some(out)
        }
        ImageFormat::Gray => {
            let mut out = Vec::with_capacity(pixels * 4);
            for &g in raw {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            Some(out)
        }
        ImageFormat::Png => None,
        _ => None,
    }
}

/// PNG → RGBA8 decoder plugged into libghostty-vt's kitty graphics pipeline.
/// Pixel data must be allocated through the provided `Allocator` so the
/// resulting `DecodedImage` lives inside the terminal's storage arena.
struct PngDecoder;

impl DecodePng for PngDecoder {
    fn decode_png<'alloc>(
        &mut self,
        alloc: &'alloc Allocator<'_>,
        data: &[u8],
    ) -> Option<DecodedImage<'alloc>> {
        use png::{ColorType, Decoder, Transformations};
        let mut decoder = Decoder::new(std::io::Cursor::new(data));
        // libghostty only ingests 8-bit RGBA, so normalise everything up-front.
        decoder.set_transformations(
            Transformations::EXPAND | Transformations::STRIP_16 | Transformations::ALPHA,
        );
        let mut reader = decoder.read_info().ok()?;
        let info = reader.info();
        let width = info.width;
        let height = info.height;
        let mut buf = Bytes::new_with_alloc(alloc, reader.output_buffer_size()).ok()?;
        let frame_info = reader.next_frame(&mut buf).ok()?;
        debug_assert_eq!(frame_info.color_type, ColorType::Rgba);
        debug_assert_eq!(frame_info.bit_depth, png::BitDepth::Eight);
        Some(DecodedImage {
            width,
            height,
            data: buf,
        })
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
