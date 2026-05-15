/**
 * Decode the packed binary frames produced by `crate::wire::FrameBuf` and
 * paint them into an xterm.js Terminal + optional kitty-graphics overlay.
 *
 * Wire format: see `src-tauri/src/wire.rs`. Single-byte discriminator:
 *   0x01 = frame, 0x02 = exit.
 */
import type { IMarker, Terminal } from "@xterm/xterm";

import {
    getBuffer,
    getCellPx,
    packAttrs,
    promoteToScrollback,
    refresh,
    type Rgb,
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

type TrackedPlacement = {
    imageId: number;
    /** Marker tied to the xterm row where this placement was first seen.
     *  Follows the row through scrollback growth; disposed when xterm
     *  trims that row off the end of its circular buffer, at which point
     *  we drop the placement. */
    marker: IMarker;
    /** Column anchor in ghostty's viewport. */
    col: number;
    pixelWidth: number;
    pixelHeight: number;
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
    z: number;
};

export type GraphicsOverlay = {
    canvas: HTMLCanvasElement;
    imageCache: Map<number, ImageBitmap>;
    /** Active placements keyed by `imageId:placementId`. Survives ghostty
     *  no longer reporting them (e.g. after the placement scrolled off
     *  the active region into history) so the image stays anchored to
     *  its xterm row. */
    placements: Map<string, TrackedPlacement>;
    /** Last DECTCEM state we propagated to xterm. Lets us write the
     *  show/hide escape only on transitions. */
    cursorVisible: boolean;
};

/** Walk one binary frame and apply it directly to `term`. */
export function applyFrame(
    term: Terminal,
    bytes: ArrayBuffer,
    overlay: GraphicsOverlay | null,
): void {
    const view = new DataView(bytes);
    const decoder = new BinaryDecoder(view);
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

function decodeAndPaintOverlay(
    decoder: BinaryDecoder,
    term: Terminal,
    overlay: GraphicsOverlay,
): void {
    const imageCount = decoder.u32();
    for (let i = 0; i < imageCount; i++) {
        const id = decoder.u32();
        const width = decoder.u32();
        const height = decoder.u32();
        const byteLen = decoder.u32();
        const pixels = decoder.bytes(byteLen);
        if (overlay.imageCache.has(id)) continue;
        const data = new ImageData(new Uint8ClampedArray(pixels), width, height);
        createImageBitmap(data)
            .then((bm) => {
                overlay.imageCache.set(id, bm);
                repaintOverlay(term, overlay);
            })
            .catch(() => {});
    }

    const placementCount = decoder.u32();
    const cursorY = term.buffer.active.cursorY;
    for (let i = 0; i < placementCount; i++) {
        const imageId = decoder.u32();
        const placementId = decoder.u32();
        const z = decoder.i32();
        const viewportCol = decoder.i32();
        const viewportRow = decoder.i32();
        const pixelWidth = decoder.u32();
        const pixelHeight = decoder.u32();
        const sourceX = decoder.u32();
        const sourceY = decoder.u32();
        const sourceWidth = decoder.u32();
        const sourceHeight = decoder.u32();
        const key = `${imageId}:${placementId}`;
        if (overlay.placements.has(key)) continue;
        const marker = term.registerMarker(viewportRow - cursorY);
        if (!marker) continue;
        marker.onDispose(() => overlay.placements.delete(key));
        overlay.placements.set(key, {
            imageId,
            marker,
            col: viewportCol,
            pixelWidth,
            pixelHeight,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            z,
        });
    }
    repaintOverlay(term, overlay);
}

/** Repaint cached placements. Called both from the per-frame path and from
 *  xterm's scroll events so images shift with the user's scroll position. */
export function repaintOverlay(term: Terminal, overlay: GraphicsOverlay): void {
    const { canvas, placements } = overlay;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cssWidth = parent.clientWidth;
    const cssHeight = parent.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(cssWidth * dpr);
    const targetH = Math.round(cssHeight * dpr);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (placements.size === 0) return;
    const { width: cellWidth, height: cellHeight } = getCellPx(term);
    if (!cellWidth || !cellHeight) return;

    const viewportY = term.buffer.active.viewportY;
    const sorted = Array.from(placements.values()).sort((a, b) => a.z - b.z);
    for (const p of sorted) {
        const bm = overlay.imageCache.get(p.imageId);
        if (!bm) continue;
        // marker.line is the placement's absolute row in xterm's buffer;
        // subtract viewportY to get its visible y. Off-screen placements
        // are still drawn — the canvas clips them.
        const y = (p.marker.line - viewportY) * cellHeight;
        ctx.drawImage(
            bm,
            p.sourceX,
            p.sourceY,
            p.sourceWidth,
            p.sourceHeight,
            p.col * cellWidth,
            y,
            p.pixelWidth,
            p.pixelHeight,
        );
    }
}

/** Attach a kitty-graphics overlay canvas above xterm.js's text. The
 *  returned overlay must be repainted whenever the user scrolls xterm so
 *  images stay anchored to ghostty's active-region rows. */
export function attachGraphicsOverlay(term: Terminal): GraphicsOverlay | null {
    if (!term.element) return null;
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "5";
    canvas.width = 0;
    canvas.height = 0;
    term.element.appendChild(canvas);
    return {
        canvas,
        imageCache: new Map(),
        placements: new Map(),
        cursorVisible: true,
    };
}

class BinaryDecoder {
    private offset = 0;
    private readonly view: DataView;

    constructor(view: DataView) {
        this.view = view;
    }

    u8(): number {
        const v = this.view.getUint8(this.offset);
        this.offset += 1;
        return v;
    }
    u16(): number {
        const v = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return v;
    }
    u32(): number {
        const v = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }
    i32(): number {
        const v = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return v;
    }
    rgb(): Rgb {
        const r = this.u8();
        const g = this.u8();
        const b = this.u8();
        return [r, g, b];
    }
    bytes(len: number): Uint8Array {
        const v = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
        this.offset += len;
        return v;
    }
    utf8(len: number): string {
        const bytes = this.bytes(len);
        return new TextDecoder().decode(bytes);
    }
    skip(len: number): void {
        this.offset += len;
    }
}
