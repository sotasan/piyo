//! Binary wire format for ghostty frames and PTY byte forwarding.
//!
//! Three message kinds, discriminated by the first byte:
//! ```text
//! [u8 kind=0x01] frame                 (ghostty cell snapshot)
//!   [u8 flags] bit 0: full redraw, bit 1: cursor present
//!   [u16 cols][u16 rows]
//!   if cursor present:
//!     [u16 x][u16 y][u8 style][u8 blink][u8 visible]
//!   [u32 active_row_count]
//!     per row: [u16 y][u16 cell_count]
//!       per cell: [u32 codepoint][u8 style_flags][u8 color_flags]
//!         color_flags bit 0: fg present, bit 1: bg present, bit 2: extended grapheme
//!         if fg present: [u8 r][u8 g][u8 b]
//!         if bg present: [u8 r][u8 g][u8 b]
//!   [u32 grapheme_count]
//!     per grapheme: [u16 y][u16 x][u16 utf8_len][utf8 bytes]
//!
//! [u8 kind=0x02] exit (no payload)
//!
//! [u8 kind=0x03] bytes                 (raw PTY chunk forwarded to xterm.js
//!                                       so its parser can track modes, OSC,
//!                                       APC graphics, kitty keyboard, etc.)
//!   [bytes...]                         until end of message
//! ```
use bitflags::bitflags;
use libghostty_vt::style::{RgbColor, Underline};

pub const KIND_FRAME: u8 = 0x01;
pub const KIND_EXIT: u8 = 0x02;
pub const KIND_BYTES: u8 = 0x03;

bitflags! {
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
        /// Cell text spans multiple codepoints; the full grapheme cluster
        /// lives in the grapheme overlay section.
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

#[derive(Clone, Copy)]
pub struct Cell {
    pub codepoint: u32,
    pub flags: CellFlags,
    pub fg: Option<RgbColor>,
    pub bg: Option<RgbColor>,
}

#[derive(Clone, Copy)]
pub struct CursorInfo {
    pub x: u16,
    pub y: u16,
    /// 0=block, 1=block_hollow, 2=underline, 3=bar.
    pub style: u8,
    pub blink: bool,
    /// Mirrors ghostty's DECTCEM state. xterm.js tracks this from its own
    /// parser; the renderer ignores this field today but it is preserved
    /// in the wire for symmetry with ghostty's cursor metadata.
    pub visible: bool,
}

/// Builder for one binary frame. Sections are buffered and concatenated by
/// [`finish`], so callers can push them in any order.
pub struct FrameBuf {
    header: Vec<u8>,
    active: Vec<u8>,
    active_rows: u32,
    graphemes: Vec<u8>,
    grapheme_count: u32,
}

impl FrameBuf {
    pub fn new(cols: u16, rows: u16, full: bool, cursor: Option<CursorInfo>) -> Self {
        let mut header = Vec::with_capacity(16);
        header.push(KIND_FRAME);
        let mut flags = FrameFlags::empty();
        if full {
            flags |= FrameFlags::FULL;
        }
        if cursor.is_some() {
            flags |= FrameFlags::CURSOR;
        }
        header.push(flags.bits());
        header.extend_from_slice(&cols.to_le_bytes());
        header.extend_from_slice(&rows.to_le_bytes());
        if let Some(c) = cursor {
            header.extend_from_slice(&c.x.to_le_bytes());
            header.extend_from_slice(&c.y.to_le_bytes());
            header.push(c.style);
            header.push(u8::from(c.blink));
            header.push(u8::from(c.visible));
        }
        Self {
            header,
            active: Vec::new(),
            active_rows: 0,
            graphemes: Vec::new(),
            grapheme_count: 0,
        }
    }

    pub fn start_active_row(&mut self, y: u16, cell_count: u16) {
        self.active.extend_from_slice(&y.to_le_bytes());
        self.active.extend_from_slice(&cell_count.to_le_bytes());
        self.active_rows += 1;
    }

    pub fn push_active_cell(&mut self, y: u16, x: u16, cell: &Cell, extras: &[char]) {
        let has_extras = !extras.is_empty();
        if has_extras {
            self.push_grapheme(y, x, cell.codepoint, extras);
        }
        let mut color = ColorFlags::empty();
        if cell.fg.is_some() {
            color |= ColorFlags::FG;
        }
        if cell.bg.is_some() {
            color |= ColorFlags::BG;
        }
        if has_extras {
            color |= ColorFlags::GRAPHEME;
        }
        self.active.extend_from_slice(&cell.codepoint.to_le_bytes());
        self.active.push(cell.flags.bits());
        self.active.push(color.bits());
        if let Some(c) = cell.fg {
            self.active.extend_from_slice(&[c.r, c.g, c.b]);
        }
        if let Some(c) = cell.bg {
            self.active.extend_from_slice(&[c.r, c.g, c.b]);
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

    pub fn finish(self) -> Vec<u8> {
        let mut out = self.header;
        out.extend_from_slice(&self.active_rows.to_le_bytes());
        out.extend_from_slice(&self.active);
        out.extend_from_slice(&self.grapheme_count.to_le_bytes());
        out.extend_from_slice(&self.graphemes);
        out
    }
}

pub fn exit_event() -> Vec<u8> {
    vec![KIND_EXIT]
}

pub fn bytes_event(chunk: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + chunk.len());
    out.push(KIND_BYTES);
    out.extend_from_slice(chunk);
    out
}

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
