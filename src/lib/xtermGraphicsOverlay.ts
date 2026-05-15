/**
 * Kitty-graphics overlay rendered above xterm.js's text layer.
 *
 * Placements are anchored to an `IMarker` so they follow their row through
 * scrollback and disappear when xterm trims the row off the end of its
 * circular buffer. Images and placements are decoded from a binary frame
 * (see `src-tauri/src/wire.rs`).
 */
import type { IMarker, Terminal } from "@xterm/xterm";

import { BinaryDecoder } from "@/lib/binaryDecoder";
import { getCellPx } from "@/lib/xtermInternals";

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

export function decodeAndPaintOverlay(
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
