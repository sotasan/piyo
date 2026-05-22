/**
 * Single typed gateway to xterm.js internals (`_core`, the buffer layout,
 * etc.). Every other file in `src/` MUST go through this shim so the
 * blast radius of an xterm.js upgrade is contained here.
 */
import type { Terminal } from "@xterm/xterm";

/** `BgFlags.HAS_EXTENDED` — set by xterm.js on cells that have entries in
 *  `BufferLine._extendedAttrs`, e.g. addon-image's image-tile metadata and
 *  OSC 8 hyperlink IDs. `applyFrame` skips overwriting those cells so the
 *  addon-owned state survives ghostty's per-chunk push. Mirrors the value
 *  in `node_modules/@xterm/xterm/src/common/buffer/Constants.ts`. */
export const BG_HAS_EXTENDED = 0x10000000;

export type PackedAttrs = {
    fg: number;
    bg: number;
    extended: Readonly<Record<string, never>>;
};

type BufferLine = {
    setCellFromCodepoint: (x: number, codepoint: number, width: number, attrs: PackedAttrs) => void;
    addCodepointToCell: (x: number, codepoint: number, width: number) => void;
    getFg: (index: number) => number;
    getBg: (index: number) => number;
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
    _renderService?: {
        dimensions?: { css?: { cell?: { width: number; height: number } } };
    };
    coreService?: {
        triggerDataEvent: (data: string, wasUserInput: boolean) => void;
    };
};

function core(term: Terminal): Core {
    return (term as unknown as { _core: Core })._core;
}

export function getBuffer(term: Terminal): Buffer | undefined {
    return core(term).buffer;
}

export function refresh(term: Terminal, start: number, end: number): void {
    core(term).refresh?.(start, end);
}

export function getCellPx(term: Terminal): { width: number; height: number } {
    const cell = core(term)._renderService?.dimensions?.css?.cell;
    return {
        width: Math.max(1, Math.round(cell?.width ?? 0)),
        height: Math.max(1, Math.round(cell?.height ?? 0)),
    };
}

/** Fire xterm's internal data event so onData/onUserInput/scroll-on-input
 *  observers see the byte, as if xterm itself had produced it. */
export function triggerDataEvent(term: Terminal, data: string): void {
    core(term).coreService?.triggerDataEvent(data, true);
}
