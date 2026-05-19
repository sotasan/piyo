//! Binary wire format for ghostty frames and PTY byte forwarding.
//!
//! Ghostty contributes only **codepoints and grapheme overlays** — fg/bg and
//! SGR styling stay with xterm.js's parser (it sees the same bytes via
//! `KIND_BYTES` and resolves palette colors against the user's theme).
//! Cursor styling/blink/visibility also stay with xterm.js; ghostty only
//! supplies the post-reflow cursor *position*.
//!
//! Three message kinds, discriminated by the first byte:
//! ```text
//! [u8 kind=0x01] frame                 (ghostty cell snapshot)
//!   [u8 flags] bit 0: full redraw, bit 1: cursor present
//!   if cursor present:
//!     [u16 x][u16 y]
//!   [u32 active_row_count]
//!     per row: [u16 y][u16 cell_count]
//!       per cell: [u32 codepoint][u8 cell_flags]
//!         cell_flags bit 0: cell has a grapheme overlay entry
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

pub const KIND_FRAME: u8 = 0x01;
pub const KIND_EXIT: u8 = 0x02;
pub const KIND_BYTES: u8 = 0x03;

/// Single per-cell flag: the cell has an entry in the grapheme overlay
/// section (>1 codepoint, e.g. emoji ZWJ sequences).
pub const CELL_GRAPHEME: u8 = 1 << 0;

bitflags! {
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct FrameFlags: u8 {
        const FULL   = 1 << 0;
        const CURSOR = 1 << 1;
    }
}

#[derive(Clone, Copy)]
pub struct CursorInfo {
    pub x: u16,
    pub y: u16,
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
    pub fn new(full: bool, cursor: Option<CursorInfo>) -> Self {
        let mut header = Vec::with_capacity(8);
        header.push(KIND_FRAME);
        let mut flags = FrameFlags::empty();
        if full {
            flags |= FrameFlags::FULL;
        }
        if cursor.is_some() {
            flags |= FrameFlags::CURSOR;
        }
        header.push(flags.bits());
        if let Some(c) = cursor {
            header.extend_from_slice(&c.x.to_le_bytes());
            header.extend_from_slice(&c.y.to_le_bytes());
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

    pub fn push_active_cell(&mut self, y: u16, x: u16, codepoint: u32, extras: &[char]) {
        let has_extras = !extras.is_empty();
        if has_extras {
            self.push_grapheme(y, x, codepoint, extras);
        }
        self.active.extend_from_slice(&codepoint.to_le_bytes());
        self.active.push(if has_extras { CELL_GRAPHEME } else { 0 });
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
