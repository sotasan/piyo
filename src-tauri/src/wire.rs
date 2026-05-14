//! Binary wire format for ghostty frames.
//!
//! Replaces per-cell JSON objects (~80 bytes/cell) with a packed binary
//! stream (~13 bytes/cell) over [`tauri::ipc::Channel<InvokeResponseBody>`].
//! The JS side decodes via `DataView`.
//!
//! Layout (little-endian, 1 byte per discriminator):
//! ```text
//! [u8 kind=0x01] frame
//!   [u8 flags] bit 0: full redraw, bit 1: cursor present
//!   [u16 cols][u16 rows]
//!   [u8 bg_r][u8 bg_g][u8 bg_b]
//!   [u8 fg_r][u8 fg_g][u8 fg_b]
//!   [u32 scrollback_rows]   total rows currently in ghostty scrollback
//!   [u32 viewport_offset]   rows scrolled up from bottom (0 = at active)
//!   if cursor present:
//!     [u16 x][u16 y][u8 style][u8 blink]
//!   [u32 row_count]
//!     per row: [u16 y][u16 cell_count]
//!       per cell: [u32 codepoint][u8 style_flags][u8 color_flags]
//!         color_flags bit 0: fg present, bit 1: bg present, bit 2: extended grapheme
//!         if fg present: [u8 r][u8 g][u8 b]
//!         if bg present: [u8 r][u8 g][u8 b]
//!   [u32 grapheme_count]
//!     per grapheme: [u16 y][u16 x][u16 utf8_len][utf8 bytes]
//!   [u32 image_count]
//!     per image: [u32 id][u32 w][u32 h][u32 byte_len][rgba bytes]
//!   [u32 placement_count]
//!     per placement: [u32 image_id][u32 placement_id][i32 z]
//!                    [i32 vp_col][i32 vp_row]
//!                    [u32 px_w][u32 px_h]
//!                    [u32 sx][u32 sy][u32 sw][u32 sh]
//! [u8 kind=0x02] exit (no payload)
//! ```
use bitflags::bitflags;
use libghostty_vt::style::{RgbColor, Underline};

pub const KIND_FRAME: u8 = 0x01;
pub const KIND_EXIT: u8 = 0x02;

bitflags! {
    /// Cell style flags. Wire format: single byte per cell.
    /// Mirrored to TS as exported constants via specta.
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct CellFlags: u8 {
        const BOLD          = 1 << 0;
        const ITALIC        = 1 << 1;
        const UNDERLINE     = 1 << 2;
        const INVERSE       = 1 << 3;
        const FAINT         = 1 << 4;
        const STRIKETHROUGH = 1 << 5;
        const BLINK         = 1 << 6;
        const INVISIBLE     = 1 << 7;
    }
}

bitflags! {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct ColorFlags: u8 {
        const FG       = 1 << 0;
        const BG       = 1 << 1;
        /// Cell text spans multiple codepoints; the actual text lives in the
        /// grapheme overlay.
        const GRAPHEME = 1 << 2;
    }
}

bitflags! {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct FrameFlags: u8 {
        const FULL   = 1 << 0;
        const CURSOR = 1 << 1;
    }
}

/// Builder for one binary frame.
pub struct FrameBuf {
    out: Vec<u8>,
    /// Position of the row-count u32 placeholder so we can patch it after all
    /// rows have been written.
    row_count_pos: usize,
    rows_written: u32,
    graphemes: Vec<u8>,
    grapheme_count: u32,
    images: Vec<u8>,
    image_count: u32,
    placements: Vec<u8>,
    placement_count: u32,
}

impl FrameBuf {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        cols: u16,
        rows: u16,
        full: bool,
        cursor: Option<(u16, u16, u8, bool)>,
        bg: RgbColor,
        fg: RgbColor,
        scrollback_rows: u32,
        viewport_offset: u32,
    ) -> Self {
        let mut out = Vec::with_capacity(64);
        out.push(KIND_FRAME);
        let mut flags = FrameFlags::empty();
        if full {
            flags |= FrameFlags::FULL;
        }
        if cursor.is_some() {
            flags |= FrameFlags::CURSOR;
        }
        out.push(flags.bits());
        out.extend_from_slice(&cols.to_le_bytes());
        out.extend_from_slice(&rows.to_le_bytes());
        out.extend_from_slice(&[bg.r, bg.g, bg.b, fg.r, fg.g, fg.b]);
        out.extend_from_slice(&scrollback_rows.to_le_bytes());
        out.extend_from_slice(&viewport_offset.to_le_bytes());
        if let Some((x, y, style, blink)) = cursor {
            out.extend_from_slice(&x.to_le_bytes());
            out.extend_from_slice(&y.to_le_bytes());
            out.push(style);
            out.push(u8::from(blink));
        }
        let row_count_pos = out.len();
        out.extend_from_slice(&0u32.to_le_bytes());
        Self {
            out,
            row_count_pos,
            rows_written: 0,
            graphemes: Vec::new(),
            grapheme_count: 0,
            images: Vec::new(),
            image_count: 0,
            placements: Vec::new(),
            placement_count: 0,
        }
    }

    pub fn start_row(&mut self, y: u16, cell_count: u16) {
        self.out.extend_from_slice(&y.to_le_bytes());
        self.out.extend_from_slice(&cell_count.to_le_bytes());
        self.rows_written += 1;
    }

    #[allow(clippy::too_many_arguments)]
    pub fn push_cell(
        &mut self,
        y: u16,
        x: u16,
        codepoint: u32,
        flags: CellFlags,
        fg: Option<RgbColor>,
        bg: Option<RgbColor>,
        extra_graphemes: &[char],
    ) {
        let mut color = ColorFlags::empty();
        if fg.is_some() {
            color |= ColorFlags::FG;
        }
        if bg.is_some() {
            color |= ColorFlags::BG;
        }
        if !extra_graphemes.is_empty() {
            color |= ColorFlags::GRAPHEME;
            self.push_grapheme(y, x, codepoint, extra_graphemes);
        }
        self.out.extend_from_slice(&codepoint.to_le_bytes());
        self.out.push(flags.bits());
        self.out.push(color.bits());
        if let Some(c) = fg {
            self.out.extend_from_slice(&[c.r, c.g, c.b]);
        }
        if let Some(c) = bg {
            self.out.extend_from_slice(&[c.r, c.g, c.b]);
        }
    }

    fn push_grapheme(&mut self, y: u16, x: u16, first: u32, rest: &[char]) {
        let mut s = String::new();
        if let Some(c) = char::from_u32(first) {
            s.push(c);
        }
        for &c in rest {
            s.push(c);
        }
        let bytes = s.as_bytes();
        let len = u16::try_from(bytes.len()).unwrap_or(u16::MAX);
        self.graphemes.extend_from_slice(&y.to_le_bytes());
        self.graphemes.extend_from_slice(&x.to_le_bytes());
        self.graphemes.extend_from_slice(&len.to_le_bytes());
        self.graphemes.extend_from_slice(&bytes[..len as usize]);
        self.grapheme_count += 1;
    }

    pub fn push_image(&mut self, id: u32, width: u32, height: u32, rgba: &[u8]) {
        let len = u32::try_from(rgba.len()).unwrap_or(u32::MAX);
        self.images.extend_from_slice(&id.to_le_bytes());
        self.images.extend_from_slice(&width.to_le_bytes());
        self.images.extend_from_slice(&height.to_le_bytes());
        self.images.extend_from_slice(&len.to_le_bytes());
        self.images.extend_from_slice(&rgba[..len as usize]);
        self.image_count += 1;
    }

    #[allow(clippy::too_many_arguments)]
    pub fn push_placement(
        &mut self,
        image_id: u32,
        placement_id: u32,
        z: i32,
        viewport_col: i32,
        viewport_row: i32,
        pixel_width: u32,
        pixel_height: u32,
        source_x: u32,
        source_y: u32,
        source_width: u32,
        source_height: u32,
    ) {
        self.placements.extend_from_slice(&image_id.to_le_bytes());
        self.placements
            .extend_from_slice(&placement_id.to_le_bytes());
        self.placements.extend_from_slice(&z.to_le_bytes());
        self.placements
            .extend_from_slice(&viewport_col.to_le_bytes());
        self.placements
            .extend_from_slice(&viewport_row.to_le_bytes());
        self.placements
            .extend_from_slice(&pixel_width.to_le_bytes());
        self.placements
            .extend_from_slice(&pixel_height.to_le_bytes());
        self.placements.extend_from_slice(&source_x.to_le_bytes());
        self.placements.extend_from_slice(&source_y.to_le_bytes());
        self.placements
            .extend_from_slice(&source_width.to_le_bytes());
        self.placements
            .extend_from_slice(&source_height.to_le_bytes());
        self.placement_count += 1;
    }

    pub fn finish(mut self) -> Vec<u8> {
        self.out[self.row_count_pos..self.row_count_pos + 4]
            .copy_from_slice(&self.rows_written.to_le_bytes());
        self.out
            .extend_from_slice(&self.grapheme_count.to_le_bytes());
        self.out.extend_from_slice(&self.graphemes);
        self.out.extend_from_slice(&self.image_count.to_le_bytes());
        self.out.extend_from_slice(&self.images);
        self.out
            .extend_from_slice(&self.placement_count.to_le_bytes());
        self.out.extend_from_slice(&self.placements);
        self.out
    }
}

pub fn exit_event() -> Vec<u8> {
    vec![KIND_EXIT]
}

/// Translate a libghostty cell style block into our packed [`CellFlags`].
pub fn cell_flags(style: &libghostty_vt::style::Style) -> CellFlags {
    let mut f = CellFlags::empty();
    if style.bold {
        f |= CellFlags::BOLD;
    }
    if style.italic {
        f |= CellFlags::ITALIC;
    }
    if !matches!(style.underline, Underline::None) {
        f |= CellFlags::UNDERLINE;
    }
    if style.inverse {
        f |= CellFlags::INVERSE;
    }
    if style.faint {
        f |= CellFlags::FAINT;
    }
    if style.strikethrough {
        f |= CellFlags::STRIKETHROUGH;
    }
    if style.blink {
        f |= CellFlags::BLINK;
    }
    if style.invisible {
        f |= CellFlags::INVISIBLE;
    }
    f
}
