//! Small helpers that read structured data out of libghostty-vt
//! per-snapshot (cursor) and per-cell (grapheme clusters).

use anyhow::{Context, Result};
use libghostty_vt::render::{CellIteration, CursorVisualStyle, Snapshot};

use crate::wire::CursorInfo;

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
