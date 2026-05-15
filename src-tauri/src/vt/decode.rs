//! Helpers that pull data out of `libghostty_vt`: PNG decoding, RGBA
//! conversion of stored kitty-graphics images, and per-snapshot reads
//! (cursor, grapheme clusters).

use anyhow::{Context, Result};
use libghostty_vt::{
    alloc::{Allocator, Bytes},
    kitty::graphics::{DecodePng, DecodedImage, ImageFormat},
    render::{CellIteration, CursorVisualStyle, Snapshot},
};

use crate::wire::CursorInfo;

pub struct PngDecoder;

impl DecodePng for PngDecoder {
    fn decode_png<'alloc>(
        &mut self,
        alloc: &'alloc Allocator<'_>,
        data: &[u8],
    ) -> Option<DecodedImage<'alloc>> {
        use png::{ColorType, Decoder, Transformations};
        let mut decoder = Decoder::new(std::io::Cursor::new(data));
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

pub fn to_rgba(raw: &[u8], format: ImageFormat, width: u32, height: u32) -> Option<Vec<u8>> {
    let pixels = (width as usize).checked_mul(height as usize)?;
    match format {
        ImageFormat::Rgba => Some(raw.to_vec()),
        ImageFormat::Rgb => Some(
            raw.chunks_exact(3)
                .flat_map(|c| [c[0], c[1], c[2], 255])
                .collect(),
        ),
        ImageFormat::GrayAlpha => Some(
            raw.chunks_exact(2)
                .flat_map(|c| [c[0], c[0], c[0], c[1]])
                .collect(),
        ),
        ImageFormat::Gray => {
            let mut out = Vec::with_capacity(pixels * 4);
            for &g in raw {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            Some(out)
        }
        // PNG already goes through `PngDecoder` before reaching storage.
        _ => None,
    }
}

pub fn read_graphemes(cell: &CellIteration<'_, '_>) -> Result<(u32, Vec<char>)> {
    let len = cell.graphemes_len().context("graphemes_len failed")?;
    if len == 0 {
        return Ok((0, Vec::new()));
    }
    let chars = cell.graphemes().context("graphemes failed")?;
    let first = chars.first().copied().unwrap_or(' ');
    Ok((first as u32, chars.into_iter().skip(1).collect()))
}

pub fn read_cursor(snap: &Snapshot<'_, '_>) -> Result<Option<CursorInfo>> {
    // Always read position even when invisible — the renderer needs to keep
    // its cursor position in sync so DECTCEM-show later puts it in the
    // right place. Only return None when ghostty has no viewport cursor
    // (e.g. resize transients).
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
    Ok(Some(CursorInfo {
        x: vp.x,
        y: vp.y,
        style,
        blink: snap.cursor_blinking().context("cursor_blinking failed")?,
        visible: snap.cursor_visible().context("cursor_visible failed")?,
    }))
}
