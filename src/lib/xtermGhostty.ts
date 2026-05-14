/**
 * Drive an xterm.js Terminal from libghostty-vt's parsed grid state.
 *
 * Ghostty parses every PTY byte in the Rust backend and ships a [`GhosttyFrame`]
 * per dirty viewport snapshot. This module writes those cells directly into
 * xterm.js's buffer and triggers a redraw — bypassing xterm.js's own VT parser
 * entirely so no byte is parsed twice.
 *
 * We reach into xterm.js's `_core` field. The TypeScript privacy markers are
 * compile-time only; at runtime everything is on the prototype, so a typed
 * cast is enough. The buffer-cell wire format mirrors
 * `node_modules/@xterm/xterm/src/common/buffer/Constants.ts`.
 */
import type { Terminal } from "@xterm/xterm";

import type { GhosttyFrame, Rgb } from "@/stores/tabs";

// Color mode: bits 25..26 of the packed fg/bg word.
const CM_RGB = 0x3000000;
// Flag bits packed into the fg word.
const FG_INVERSE = 0x04000000;
const FG_BOLD = 0x08000000;
const FG_UNDERLINE = 0x10000000;
const FG_BLINK = 0x20000000;
const FG_INVISIBLE = 0x40000000;
const FG_STRIKETHROUGH = 0x80000000;
// Flag bits packed into the bg word.
const BG_ITALIC = 0x04000000;
const BG_DIM = 0x08000000;

// libghostty-vt frame flag bits (mirror src-tauri/src/vt.rs).
const F_BOLD = 1;
const F_ITALIC = 2;
const F_UNDERLINE = 4;
const F_INVERSE = 8;
const F_FAINT = 16;
const F_STRIKETHROUGH = 32;
const F_BLINK = 64;
const F_INVISIBLE = 128;

const SPACE = 0x20;
const EMPTY_EXTENDED = Object.freeze({});

function packColor(rgb: Rgb): number {
    // CM_RGB | (r << 16) | (g << 8) | b — 24-bit RGB with the RGB color-mode tag.
    return CM_RGB | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

function packAttrs(flags: number, fgRgb: Rgb | null, bgRgb: Rgb | null) {
    let fg = fgRgb ? packColor(fgRgb) : 0;
    let bg = bgRgb ? packColor(bgRgb) : 0;
    if (flags & F_BOLD) fg |= FG_BOLD;
    if (flags & F_UNDERLINE) fg |= FG_UNDERLINE;
    if (flags & F_INVERSE) fg |= FG_INVERSE;
    if (flags & F_BLINK) fg |= FG_BLINK;
    if (flags & F_INVISIBLE) fg |= FG_INVISIBLE;
    if (flags & F_STRIKETHROUGH) fg |= FG_STRIKETHROUGH;
    if (flags & F_ITALIC) bg |= BG_ITALIC;
    if (flags & F_FAINT) bg |= BG_DIM;
    return { fg, bg, extended: EMPTY_EXTENDED };
}

/**
 * Apply one [`GhosttyFrame`] to `term`'s active buffer.
 *
 * Cells whose text is empty are filled with a single space so xterm.js's
 * renderer treats the cell as occupied (otherwise per-row width / cursor
 * accounting drifts).
 */
export function applyGhosttyFrame(term: Terminal, frame: GhosttyFrame): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (term as unknown as { _core: any })._core;
    const buffer = core?.buffer;
    if (!buffer) return;

    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;

    for (const row of frame.dirty) {
        const line = buffer.lines?.get(buffer.ybase + row.y);
        if (!line) continue;
        for (let x = 0; x < row.cells.length; x++) {
            const cell = row.cells[x];
            const codepoint = cell.text.length === 0 ? SPACE : (cell.text.codePointAt(0) ?? SPACE);
            line.setCellFromCodepoint(x, codepoint, 1, packAttrs(cell.flags, cell.fg, cell.bg));
        }
        line.isWrapped = false;
        if (row.y < minRow) minRow = row.y;
        if (row.y > maxRow) maxRow = row.y;
    }

    if (frame.cursor) {
        buffer.x = frame.cursor.x;
        buffer.y = frame.cursor.y;
        // Mirror ghostty's cursor shape / blink onto xterm.js so the
        // rendered cursor matches what DECSCUSR or DEC mode 12 asked for.
        const desiredStyle = CURSOR_STYLES[frame.cursor.style];
        if (desiredStyle && term.options.cursorStyle !== desiredStyle) {
            term.options.cursorStyle = desiredStyle;
        }
        if (term.options.cursorBlink !== frame.cursor.blinking) {
            term.options.cursorBlink = frame.cursor.blinking;
        }
    }

    if (minRow <= maxRow && typeof core.refresh === "function") {
        core.refresh(minRow, maxRow);
    }
}

const CURSOR_STYLES: Record<number, "block" | "underline" | "bar"> = {
    0: "block",
    1: "block",
    2: "underline",
    3: "bar",
};
