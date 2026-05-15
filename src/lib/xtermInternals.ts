/**
 * Single typed gateway to xterm.js internals (`_core`, the buffer-cell bit
 * layout, etc.). Every other file in `src/` MUST go through this shim so the
 * blast radius of an xterm.js upgrade is contained here.
 *
 * The bit-packing constants below are copied verbatim from
 * `node_modules/@xterm/xterm/src/common/buffer/Constants.ts` at the time of
 * writing. If you bump `@xterm/xterm`, re-read that file and confirm these
 * still match — they are deliberately pinned via `=` in `package.json`.
 */
import type { Terminal } from "@xterm/xterm";

// Bits 25..26 of the packed fg/bg word = color mode.
const CM_RGB = 0x3000000;
// Flags packed into the fg word.
const FG_INVERSE = 0x04000000;
const FG_BOLD = 0x08000000;
const FG_UNDERLINE = 0x10000000;
const FG_BLINK = 0x20000000;
const FG_INVISIBLE = 0x40000000;
const FG_STRIKETHROUGH = 0x80000000;
// Flags packed into the bg word.
const BG_ITALIC = 0x04000000;
const BG_DIM = 0x08000000;

const EMPTY_EXTENDED = Object.freeze({});

export type Rgb = readonly [number, number, number];

export type PackedAttrs = {
    fg: number;
    bg: number;
    extended: Readonly<Record<string, never>>;
};

export type StyleFlags = number;
export const STYLE_BOLD = 1;
export const STYLE_ITALIC = 2;
export const STYLE_UNDERLINE = 4;
export const STYLE_INVERSE = 8;
export const STYLE_FAINT = 16;
export const STYLE_STRIKETHROUGH = 32;
export const STYLE_BLINK = 64;
export const STYLE_INVISIBLE = 128;

function packColor(rgb: Rgb): number {
    return CM_RGB | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

/** Pack ghostty-flavoured style flags + RGB into xterm.js's internal cell
 *  attribute words. */
export function packAttrs(flags: StyleFlags, fgRgb: Rgb | null, bgRgb: Rgb | null): PackedAttrs {
    let fg = fgRgb ? packColor(fgRgb) : 0;
    let bg = bgRgb ? packColor(bgRgb) : 0;
    if (flags & STYLE_BOLD) fg |= FG_BOLD;
    if (flags & STYLE_UNDERLINE) fg |= FG_UNDERLINE;
    if (flags & STYLE_INVERSE) fg |= FG_INVERSE;
    if (flags & STYLE_BLINK) fg |= FG_BLINK;
    if (flags & STYLE_INVISIBLE) fg |= FG_INVISIBLE;
    if (flags & STYLE_STRIKETHROUGH) fg |= FG_STRIKETHROUGH;
    if (flags & STYLE_ITALIC) bg |= BG_ITALIC;
    if (flags & STYLE_FAINT) bg |= BG_DIM;
    return { fg, bg, extended: EMPTY_EXTENDED };
}

type BufferLine = {
    setCellFromCodepoint: (x: number, codepoint: number, width: number, attrs: PackedAttrs) => void;
    isWrapped: boolean;
};

type Buffer = {
    x: number;
    y: number;
    ybase: number;
    lines?: { get(i: number): BufferLine | undefined };
};

type Core = {
    buffer?: Buffer;
    refresh?: (start: number, end: number) => void;
    _bufferService?: { scroll: (eraseAttr: unknown, isWrapped?: boolean) => void };
    _inputHandler?: { _eraseAttrData: () => unknown };
    _renderService?: {
        dimensions?: { css?: { cell?: { width: number; height: number } } };
    };
};

function core(term: Terminal): Core {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (term as unknown as { _core: any })._core;
}

export function getBuffer(term: Terminal): Buffer | undefined {
    return core(term).buffer;
}

export function refresh(term: Terminal, start: number, end: number): void {
    core(term).refresh?.(start, end);
}

/** Promote one row of the active region into xterm's scrollback. Mirrors
 *  what xterm's own InputHandler does on `\n` when the cursor is at the
 *  bottom of the scroll region. Used here to advance the buffer when
 *  ghostty has just evicted N rows from its active screen. */
export function promoteToScrollback(term: Terminal, count: number): void {
    if (count <= 0) return;
    const c = core(term);
    const scroll = c._bufferService?.scroll;
    const eraseAttr = c._inputHandler?._eraseAttrData();
    if (!scroll || eraseAttr === undefined) return;
    for (let i = 0; i < count; i++) {
        scroll.call(c._bufferService, eraseAttr);
    }
}

export function getCellPx(term: Terminal): { width: number; height: number } {
    const cell = core(term)._renderService?.dimensions?.css?.cell;
    return {
        width: Math.max(1, Math.round(cell?.width ?? 0)),
        height: Math.max(1, Math.round(cell?.height ?? 0)),
    };
}
