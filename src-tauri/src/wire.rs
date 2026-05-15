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
//!   if cursor present:
//!     [u16 x][u16 y][u8 style][u8 blink][u8 visible]
//!   [u32 scrollback_promotions]   rows just evicted from active. Renderer
//!                                  calls xterm.scroll() this many times
//!                                  before writing the new active region;
//!                                  no cell data needed because xterm
//!                                  already has them at active row 0..N-1.
//!   [u32 active_row_count]
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
//!                    [u32 x_offset][u32 y_offset]   sub-cell pixel offsets
//! [u8 kind=0x02] exit (no payload)
//! ```
use bitflags::bitflags;
use libghostty_vt::style::{RgbColor, Underline};

pub const KIND_FRAME: u8 = 0x01;
pub const KIND_EXIT: u8 = 0x02;

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
    /// Mirrors ghostty's DECTCEM state (mode 25). When `false`, the
    /// renderer hides the cursor via `\x1b[?25l`.
    pub visible: bool,
}

/// Builder for one binary frame. Sections are buffered and concatenated by
/// [`finish`], so callers can push them in any order.
pub struct FrameBuf {
    header: Vec<u8>,
    scrollback_promotions: u32,
    active: Vec<u8>,
    active_rows: u32,
    graphemes: Vec<u8>,
    grapheme_count: u32,
    images: Vec<u8>,
    image_count: u32,
    placements: Vec<u8>,
    placement_count: u32,
}

impl FrameBuf {
    pub fn new(
        cols: u16,
        rows: u16,
        full: bool,
        cursor: Option<CursorInfo>,
        bg: RgbColor,
        fg: RgbColor,
    ) -> Self {
        let mut header = Vec::with_capacity(32);
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
        header.extend_from_slice(&[bg.r, bg.g, bg.b, fg.r, fg.g, fg.b]);
        if let Some(c) = cursor {
            header.extend_from_slice(&c.x.to_le_bytes());
            header.extend_from_slice(&c.y.to_le_bytes());
            header.push(c.style);
            header.push(u8::from(c.blink));
            header.push(u8::from(c.visible));
        }
        Self {
            header,
            scrollback_promotions: 0,
            active: Vec::new(),
            active_rows: 0,
            graphemes: Vec::new(),
            grapheme_count: 0,
            images: Vec::new(),
            image_count: 0,
            placements: Vec::new(),
            placement_count: 0,
        }
    }

    pub fn set_scrollback_promotions(&mut self, count: u32) {
        self.scrollback_promotions = count;
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
        x_offset: u32,
        y_offset: u32,
    ) {
        let p = &mut self.placements;
        p.extend_from_slice(&image_id.to_le_bytes());
        p.extend_from_slice(&placement_id.to_le_bytes());
        p.extend_from_slice(&z.to_le_bytes());
        p.extend_from_slice(&viewport_col.to_le_bytes());
        p.extend_from_slice(&viewport_row.to_le_bytes());
        p.extend_from_slice(&pixel_width.to_le_bytes());
        p.extend_from_slice(&pixel_height.to_le_bytes());
        p.extend_from_slice(&source_x.to_le_bytes());
        p.extend_from_slice(&source_y.to_le_bytes());
        p.extend_from_slice(&source_width.to_le_bytes());
        p.extend_from_slice(&source_height.to_le_bytes());
        p.extend_from_slice(&x_offset.to_le_bytes());
        p.extend_from_slice(&y_offset.to_le_bytes());
        self.placement_count += 1;
    }

    pub fn finish(self) -> Vec<u8> {
        let mut out = self.header;
        out.extend_from_slice(&self.scrollback_promotions.to_le_bytes());
        out.extend_from_slice(&self.active_rows.to_le_bytes());
        out.extend_from_slice(&self.active);
        out.extend_from_slice(&self.grapheme_count.to_le_bytes());
        out.extend_from_slice(&self.graphemes);
        out.extend_from_slice(&self.image_count.to_le_bytes());
        out.extend_from_slice(&self.images);
        out.extend_from_slice(&self.placement_count.to_le_bytes());
        out.extend_from_slice(&self.placements);
        out
    }
}

pub fn exit_event() -> Vec<u8> {
    vec![KIND_EXIT]
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

#[cfg(test)]
mod tests {
    //! Round-trip tests for the binary frame format defined above. We
    //! hand-decode the produced bytes and compare against the values we
    //! encoded, catching layout drifts in either direction.

    use libghostty_vt::style::RgbColor;

    use super::{Cell, CellFlags, CursorInfo, FrameBuf, KIND_EXIT, KIND_FRAME, exit_event};

    fn rgb(r: u8, g: u8, b: u8) -> RgbColor {
        RgbColor { r, g, b }
    }

    #[test]
    fn exit_event_is_a_single_discriminator_byte() {
        assert_eq!(exit_event(), vec![KIND_EXIT]);
    }

    #[test]
    fn minimal_frame_serialises_header_then_empty_sections() {
        let bytes = FrameBuf::new(80, 24, false, None, rgb(1, 2, 3), rgb(4, 5, 6)).finish();

        let mut cursor = Cursor::new(&bytes);
        assert_eq!(cursor.u8(), KIND_FRAME);
        assert_eq!(cursor.u8(), 0, "no full/cursor flags set");
        assert_eq!(cursor.u16(), 80);
        assert_eq!(cursor.u16(), 24);
        assert_eq!(cursor.next_n(3), [1, 2, 3]);
        assert_eq!(cursor.next_n(3), [4, 5, 6]);
        assert_eq!(cursor.u32(), 0, "scrollback promotions");
        assert_eq!(cursor.u32(), 0, "active row count");
        assert_eq!(cursor.u32(), 0, "grapheme count");
        assert_eq!(cursor.u32(), 0, "image count");
        assert_eq!(cursor.u32(), 0, "placement count");
        assert!(cursor.eof());
    }

    #[test]
    fn full_redraw_flag_is_packed_into_the_frame_byte() {
        let bytes = FrameBuf::new(1, 1, true, None, rgb(0, 0, 0), rgb(0, 0, 0)).finish();
        assert_eq!(bytes[0], KIND_FRAME);
        assert_eq!(bytes[1] & 0b01, 0b01, "FULL flag bit is set");
        assert_eq!(bytes[1] & 0b10, 0, "CURSOR flag bit is not set");
    }

    #[test]
    fn cursor_payload_is_emitted_when_present() {
        let cursor = CursorInfo {
            x: 13,
            y: 7,
            style: 2,
            blink: true,
            visible: false,
        };
        let bytes = FrameBuf::new(80, 24, false, Some(cursor), rgb(0, 0, 0), rgb(0, 0, 0)).finish();
        let mut c = Cursor::new(&bytes);
        assert_eq!(c.u8(), KIND_FRAME);
        assert_eq!(c.u8() & 0b10, 0b10, "CURSOR flag bit");
        c.u16(); // cols
        c.u16(); // rows
        c.next_n(6); // bg+fg
        assert_eq!(c.u16(), 13);
        assert_eq!(c.u16(), 7);
        assert_eq!(c.u8(), 2);
        assert_eq!(c.u8(), 1, "blink");
        assert_eq!(c.u8(), 0, "visible=false");
    }

    #[test]
    fn active_row_with_one_styled_cell_encodes_correctly() {
        let mut buf = FrameBuf::new(2, 1, false, None, rgb(0, 0, 0), rgb(0, 0, 0));
        buf.start_active_row(0, 1);
        buf.push_active_cell(
            0,
            0,
            &Cell {
                codepoint: u32::from('A'),
                flags: CellFlags::BOLD | CellFlags::UNDERLINE,
                fg: Some(rgb(255, 0, 0)),
                bg: None,
            },
            &[],
        );
        let bytes = buf.finish();

        let mut c = Cursor::new(&bytes);
        c.u8(); // kind
        c.u8(); // flags
        c.u16(); // cols
        c.u16(); // rows
        c.next_n(6); // bg+fg
        c.u32(); // scrollback promotions

        assert_eq!(c.u32(), 1, "one active row");
        assert_eq!(c.u16(), 0, "row y");
        assert_eq!(c.u16(), 1, "row cell count");
        assert_eq!(c.u32(), u32::from('A'));
        let style_flags = c.u8();
        assert_eq!(style_flags, (CellFlags::BOLD | CellFlags::UNDERLINE).bits());
        let color_flags = c.u8();
        assert_eq!(color_flags & 0b001, 0b001, "FG present");
        assert_eq!(color_flags & 0b010, 0, "BG absent");
        assert_eq!(color_flags & 0b100, 0, "no grapheme overlay");
        assert_eq!(c.next_n(3), [255, 0, 0]);

        assert_eq!(c.u32(), 0, "grapheme count");
        assert_eq!(c.u32(), 0, "image count");
        assert_eq!(c.u32(), 0, "placement count");
        assert!(c.eof());
    }

    #[test]
    fn extras_on_a_cell_emit_a_grapheme_overlay_entry() {
        let mut buf = FrameBuf::new(2, 1, false, None, rgb(0, 0, 0), rgb(0, 0, 0));
        buf.start_active_row(0, 1);
        // base 'e' + combining acute accent — two codepoints, one grapheme.
        buf.push_active_cell(
            0,
            0,
            &Cell {
                codepoint: u32::from('e'),
                flags: CellFlags::empty(),
                fg: None,
                bg: None,
            },
            &['\u{0301}'],
        );
        let bytes = buf.finish();

        let mut c = Cursor::new(&bytes);
        c.u8(); // kind
        c.u8(); // flags
        c.u16();
        c.u16();
        c.next_n(6);
        c.u32(); // scrollback

        assert_eq!(c.u32(), 1, "one active row");
        c.u16(); // row y
        c.u16(); // row cell count
        c.u32(); // codepoint
        c.u8(); // style flags
        let color_flags = c.u8();
        assert_eq!(color_flags & 0b100, 0b100, "GRAPHEME flag set");

        assert_eq!(c.u32(), 1, "one grapheme entry");
        assert_eq!(c.u16(), 0, "grapheme y");
        assert_eq!(c.u16(), 0, "grapheme x");
        let len = c.u16() as usize;
        let utf8 = c.next_n(len);
        let s = std::str::from_utf8(&utf8).unwrap();
        assert_eq!(s, "e\u{0301}");
    }

    #[test]
    fn scrollback_promotions_are_serialised_before_active_rows() {
        let mut buf = FrameBuf::new(80, 24, false, None, rgb(0, 0, 0), rgb(0, 0, 0));
        buf.set_scrollback_promotions(7);
        let bytes = buf.finish();
        let mut c = Cursor::new(&bytes);
        c.u8(); // kind
        c.u8(); // flags
        c.u16(); // cols
        c.u16(); // rows
        c.next_n(6); // bg+fg
        assert_eq!(c.u32(), 7);
        assert_eq!(c.u32(), 0, "no active rows");
    }

    #[test]
    fn image_section_is_serialised_with_length_prefix() {
        let mut buf = FrameBuf::new(80, 24, false, None, rgb(0, 0, 0), rgb(0, 0, 0));
        buf.push_image(42, 2, 1, &[10, 20, 30, 255, 40, 50, 60, 255]);
        let bytes = buf.finish();
        let mut c = Cursor::new(&bytes);
        c.u8(); // kind
        c.u8(); // flags
        c.u16(); // cols
        c.u16(); // rows
        c.next_n(6); // bg+fg
        c.u32(); // scrollback
        c.u32(); // active rows
        c.u32(); // grapheme count

        assert_eq!(c.u32(), 1, "image count");
        assert_eq!(c.u32(), 42, "image id");
        assert_eq!(c.u32(), 2, "width");
        assert_eq!(c.u32(), 1, "height");
        assert_eq!(c.u32(), 8, "byte length");
        assert_eq!(c.next_n(8), [10, 20, 30, 255, 40, 50, 60, 255]);
    }

    // ── tiny hand-rolled cursor so the test mirrors how the TS decoder reads ──

    struct Cursor<'a> {
        bytes: &'a [u8],
        pos: usize,
    }

    impl<'a> Cursor<'a> {
        fn new(bytes: &'a [u8]) -> Self {
            Self { bytes, pos: 0 }
        }

        fn u8(&mut self) -> u8 {
            let v = self.bytes[self.pos];
            self.pos += 1;
            v
        }

        fn u16(&mut self) -> u16 {
            let v = u16::from_le_bytes(self.bytes[self.pos..self.pos + 2].try_into().unwrap());
            self.pos += 2;
            v
        }

        fn u32(&mut self) -> u32 {
            let v = u32::from_le_bytes(self.bytes[self.pos..self.pos + 4].try_into().unwrap());
            self.pos += 4;
            v
        }

        fn next_n(&mut self, n: usize) -> Vec<u8> {
            let v = self.bytes[self.pos..self.pos + n].to_vec();
            self.pos += n;
            v
        }

        fn eof(&self) -> bool {
            self.pos == self.bytes.len()
        }
    }
}
