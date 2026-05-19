//! Small helpers that read structured data out of libghostty-vt
//! per-snapshot (cursor) and per-cell (grapheme clusters).

use anyhow::{Context, Result};
use libghostty_vt::render::{CellIteration, Snapshot};

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
    Ok(Some(CursorInfo { x: vp.x, y: vp.y }))
}
