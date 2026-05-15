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
import { getBuffer, packAttrs, promoteToScrollback, refresh } from "@/lib/xtermInternals";

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
    const graphemeIndex = new Map<number, string>();
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
            line.setCellFromCodepoint(x, cp, 1, packAttrs(styleFlags, fg, bg));
            if ((colorFlags & COLOR_GRAPHEME) !== 0) {
                graphemeIndex.set((y << 16) | x, "");
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
        // Replace the cell's single-codepoint we wrote above with the full
        // multi-codepoint grapheme cluster.
        const key = (y << 16) | x;
        if (graphemeIndex.has(key)) {
            const line = buffer.lines?.get(buffer.ybase + y);
            const cp = text.codePointAt(0) ?? SPACE;
            // setCellFromCodepoint only takes one cp; for graphemes we still
            // start with the base cp. xterm's grapheme rendering then handles
            // combining marks via its own buffer state. Good enough for now;
            // proper grapheme cluster support requires the extended path.
            line?.setCellFromCodepoint(x, cp, 1, packAttrs(0, null, null));
        }
    }

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
    if (fullRedraw) refresh(term, 0, term.rows - 1);

    if (overlay) decodeAndPaintOverlay(decoder, term, overlay);
}
