/**
 * Decode the packed binary frames produced by `crate::wire::FrameBuf` and
 * paint them into an xterm.js Terminal + optional kitty-graphics overlay.
 *
 * Wire format: see `src-tauri/src/wire.rs`. Single-byte discriminator:
 *   0x01 = frame, 0x02 = exit.
 */
import type { Terminal } from "@xterm/xterm";

import { BinaryDecoder } from "@/lib/binaryDecoder";
import { decodeAndPaintOverlay, type GraphicsOverlay } from "@/lib/xtermGraphicsOverlay";
import {
    getBuffer,
    packAttrs,
    type PackedAttrs,
    promoteToScrollback,
    refresh,
} from "@/lib/xtermInternals";

export const KIND_FRAME = 0x01;
export const KIND_EXIT = 0x02;

// Mirrors `wire::FrameFlags`.
const FRAME_FULL = 1 << 0;
const FRAME_CURSOR = 1 << 1;
// Mirrors `wire::ColorFlags`.
const COLOR_FG = 1 << 0;
const COLOR_BG = 1 << 1;
const COLOR_GRAPHEME = 1 << 2;

const SPACE = 0x20;
const CURSOR_STYLES: Record<number, "block" | "underline" | "bar"> = {
    0: "block",
    1: "block",
    2: "underline",
    3: "bar",
};

/** Walk one binary frame and apply it directly to `term`. */
export function applyFrame(
    term: Terminal,
    bytes: ArrayBuffer,
    overlay: GraphicsOverlay | null,
): void {
    const decoder = new BinaryDecoder(new DataView(bytes));
    const kind = decoder.u8();
    if (kind !== KIND_FRAME) return;
    const frameFlags = decoder.u8();
    decoder.u16(); // cols, unused on render side
    decoder.u16(); // rows, unused on render side
    decoder.skip(6); // bg+fg RGB; xterm theme already has these
    const cursor =
        (frameFlags & FRAME_CURSOR) !== 0
            ? {
                  x: decoder.u16(),
                  y: decoder.u16(),
                  style: decoder.u8(),
                  blink: decoder.u8() !== 0,
                  visible: decoder.u8() !== 0,
              }
            : null;
    const fullRedraw = (frameFlags & FRAME_FULL) !== 0;

    const scrollbackPromotions = decoder.u32();
    if (scrollbackPromotions > 0) promoteToScrollback(term, scrollbackPromotions);

    const buffer = getBuffer(term);
    if (!buffer) return;
    const rowCount = decoder.u32();
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    // Cells flagged as having a grapheme overlay: keep the attrs we just
    // packed so the grapheme pass can re-set the base codepoint with the
    // same styling and only append combining marks via addCodepointToCell.
    const graphemeAttrs = new Map<number, PackedAttrs>();
    for (let r = 0; r < rowCount; r++) {
        const y = decoder.u16();
        const cellCount = decoder.u16();
        const line = buffer.lines?.get(buffer.ybase + y);
        for (let x = 0; x < cellCount; x++) {
            const codepoint = decoder.u32();
            const styleFlags = decoder.u8();
            const colorFlags = decoder.u8();
            const fg = (colorFlags & COLOR_FG) !== 0 ? decoder.rgb() : null;
            const bg = (colorFlags & COLOR_BG) !== 0 ? decoder.rgb() : null;
            if (!line) continue;
            const cp = codepoint === 0 ? SPACE : codepoint;
            const attrs = packAttrs(styleFlags, fg, bg);
            line.setCellFromCodepoint(x, cp, 1, attrs);
            if ((colorFlags & COLOR_GRAPHEME) !== 0) {
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
        // Iterate Unicode codepoints, not UTF-16 code units, so surrogate
        // pairs (emoji etc.) stay intact. The first codepoint reseats the
        // cell with the original attrs; the rest append as combining marks
        // so neither the base codepoint nor the styling gets overwritten.
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
        const desired = CURSOR_STYLES[cursor.style];
        if (desired && term.options.cursorStyle !== desired) term.options.cursorStyle = desired;
        if (term.options.cursorBlink !== cursor.blink) term.options.cursorBlink = cursor.blink;
        // Mirror ghostty's DECTCEM into xterm. Writing the escape lets
        // xterm's parser update its own cursor-visibility state.
        if (overlay && overlay.cursorVisible !== cursor.visible) {
            term.write(cursor.visible ? "\x1b[?25h" : "\x1b[?25l");
            overlay.cursorVisible = cursor.visible;
        }
    }

    if (minRow <= maxRow) refresh(term, minRow, maxRow);
    else if (cursor && !fullRedraw) {
        // Cursor-only frame: nudge the renderer so the cursor's old and
        // new rows actually repaint. xterm picks up buffer.x/y on its
        // next render tick anyway, but an explicit refresh keeps the
        // cursor responsive when the renderer is idle.
        const lo = Math.min(prevCursorY, buffer.y);
        const hi = Math.max(prevCursorY, buffer.y);
        refresh(term, lo, hi);
    }
    if (fullRedraw) refresh(term, 0, term.rows - 1);

    if (overlay) decodeAndPaintOverlay(decoder, term, overlay);
}
