/**
 * Decode the packed binary frames produced by `crate::wire::FrameBuf` and
 * paint ghostty's codepoints + grapheme overlays into xterm.js's buffer.
 *
 * Ghostty only contributes cell text and post-reflow cursor position;
 * fg/bg/style and cursor visual style stay with xterm.js (it sees the same
 * bytes via KIND_BYTES and resolves palette colors against the user's
 * theme). Wire format: see `src-tauri/src/wire.rs`.
 */
import type { Terminal } from "@xterm/xterm";

import { BinaryDecoder } from "@/lib/binaryDecoder";
import { BG_HAS_EXTENDED, getBuffer, type PackedAttrs, refresh } from "@/lib/xtermInternals";

const EMPTY_PRESERVED: Readonly<Record<string, never>> = Object.freeze({});

export const KIND_FRAME = 0x01;
export const KIND_EXIT = 0x02;
export const KIND_BYTES = 0x03;

// Mirrors `wire::FrameFlags`.
const FRAME_FULL = 1 << 0;
const FRAME_CURSOR = 1 << 1;
// Mirrors `wire::CELL_GRAPHEME`.
const CELL_GRAPHEME = 1 << 0;

const SPACE = 0x20;

/** Walk one binary frame and apply it directly to `term`. */
export function applyFrame(term: Terminal, bytes: ArrayBuffer): void {
    const decoder = new BinaryDecoder(new DataView(bytes));
    const kind = decoder.u8();
    if (kind !== KIND_FRAME) return;
    const frameFlags = decoder.u8();
    const cursor =
        (frameFlags & FRAME_CURSOR) !== 0 ? { x: decoder.u16(), y: decoder.u16() } : null;
    const fullRedraw = (frameFlags & FRAME_FULL) !== 0;

    const buffer = getBuffer(term);
    if (!buffer) return;
    const rowCount = decoder.u32();
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    const graphemeAttrs = new Map<number, PackedAttrs>();
    for (let r = 0; r < rowCount; r++) {
        const y = decoder.u16();
        const cellCount = decoder.u16();
        const line = buffer.lines?.get(buffer.ybase + y);
        for (let x = 0; x < cellCount; x++) {
            const codepoint = decoder.u32();
            const cellFlags = decoder.u8();
            if (!line) continue;
            // Skip cells owned by xterm.js addons (addon-image image
            // tiles, OSC 8 hyperlinks) — they ride on
            // `BgFlags.HAS_EXTENDED` + `_extendedAttrs[col]`.
            const bgWithFlags = line.getBg(x);
            if ((bgWithFlags & BG_HAS_EXTENDED) !== 0) continue;
            const cp = codepoint === 0 ? SPACE : codepoint;
            const attrs: PackedAttrs = {
                fg: line.getFg(x),
                bg: bgWithFlags,
                extended: EMPTY_PRESERVED,
            };
            line.setCellFromCodepoint(x, cp, 1, attrs);
            if ((cellFlags & CELL_GRAPHEME) !== 0) {
                graphemeAttrs.set((y << 16) | x, attrs);
            }
        }
        if (line) line.isWrapped = false;
        if (y < minRow) minRow = y;
        if (y > maxRow) maxRow = y;
    }

    const graphemeCount = decoder.u32();
    for (let g = 0; g < graphemeCount; g++) {
        const y = decoder.u16();
        const x = decoder.u16();
        const len = decoder.u16();
        const text = decoder.utf8(len);
        const key = (y << 16) | x;
        const attrs = graphemeAttrs.get(key);
        if (!attrs) continue;
        const line = buffer.lines?.get(buffer.ybase + y);
        if (!line) continue;
        const points = Array.from(text);
        if (points.length === 0) continue;
        const base = points[0].codePointAt(0) ?? SPACE;
        line.setCellFromCodepoint(x, base, 1, attrs);
        for (let i = 1; i < points.length; i++) {
            const cp = points[i].codePointAt(0);
            if (cp !== undefined) line.addCodepointToCell(x, cp, 0);
        }
    }

    const prevCursorY = buffer.y;
    if (cursor) {
        buffer.x = cursor.x;
        buffer.y = cursor.y;
    }

    if (minRow <= maxRow) refresh(term, minRow, maxRow);
    else if (cursor && !fullRedraw) {
        const lo = Math.min(prevCursorY, buffer.y);
        const hi = Math.max(prevCursorY, buffer.y);
        refresh(term, lo, hi);
    }
    if (fullRedraw) refresh(term, 0, term.rows - 1);
}
