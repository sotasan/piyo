/**
 * Bridge browser mouse + wheel events into the typed IPC mouse command.
 * Mode-dependent VT encoding happens in Rust against ghostty's encoders.
 */
import { ptySendMouse } from "@/ipc/commands";
import { ACTION_PRESS, ACTION_RELEASE, MOUSE_ACTION_MOTION, packMods } from "@/lib/inputModifiers";
import { getPtyModes } from "@/lib/ptyModes";

export type MouseAnchor = HTMLElement;

/** Pixels of trackpad scroll per emitted wheel click. Trackpads on macOS
 *  fire many tiny per-frame deltas; without accumulation a single swipe
 *  emits dozens of wheel events. Tuned to feel like ghostty's default. */
const PIXELS_PER_WHEEL_CLICK = 80;
// Per-PTY accumulator so a partial scroll in one tab can't leak clicks into
// a different tab when the user switches focus mid-swipe.
const wheelAccum = new Map<number, number>();

function isTracking(rid: number): boolean {
    return getPtyModes(rid).mouseTracking;
}

type Size = {
    screenWidth: number;
    screenHeight: number;
    cellWidth: number;
    cellHeight: number;
};

function anchorSize(rect: DOMRect, cols: number, rows: number): Size {
    return {
        screenWidth: Math.max(1, Math.round(rect.width)),
        screenHeight: Math.max(1, Math.round(rect.height)),
        cellWidth: Math.max(1, Math.round(rect.width / Math.max(1, cols))),
        cellHeight: Math.max(1, Math.round(rect.height / Math.max(1, rows))),
    };
}

/** Encode wheel scrolling as mouse-button events for apps that have mouse
 *  tracking enabled (lazygit, htop, btop, vim with mouse=a, etc). Returns
 *  true when we encoded; false to let xterm scroll its own scrollback. */
export function handleWheel(
    rid: number,
    anchor: MouseAnchor,
    cols: number,
    rows: number,
    e: WheelEvent,
): boolean {
    if (!isTracking(rid) || e.deltaY === 0) return false;

    // Pixel-mode (trackpad / smooth wheel): accumulate and emit one click
    // per threshold. Line/page-mode (legacy mouse wheel): pass through.
    let clicks: number;
    if (e.deltaMode === 0) {
        const next = (wheelAccum.get(rid) ?? 0) + e.deltaY;
        clicks = Math.trunc(next / PIXELS_PER_WHEEL_CLICK);
        if (clicks === 0) {
            wheelAccum.set(rid, next);
            return true;
        }
        wheelAccum.set(rid, next - clicks * PIXELS_PER_WHEEL_CLICK);
    } else {
        clicks = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY)));
    }

    const rect = anchor.getBoundingClientRect();
    const button = clicks < 0 ? 3 : 4; // Four = up, Five = down
    const size = anchorSize(rect, cols, rows);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const mods = packMods(e);
    for (let i = 0; i < Math.abs(clicks); i++) {
        void ptySendMouse(rid, {
            action: ACTION_PRESS,
            button,
            mods,
            x,
            y,
            size,
            anyPressed: false,
        });
    }
    return true;
}

export function handleMouse(
    rid: number,
    anchor: MouseAnchor,
    cols: number,
    rows: number,
    e: MouseEvent,
): void {
    // Motion events are only meaningful when the terminal is in a tracking mode.
    if (e.type === "mousemove" && !isTracking(rid)) return;
    const rect = anchor.getBoundingClientRect();
    const action =
        e.type === "mousedown"
            ? ACTION_PRESS
            : e.type === "mouseup"
              ? ACTION_RELEASE
              : MOUSE_ACTION_MOTION;
    void ptySendMouse(rid, {
        action,
        button: mouseButton(e),
        mods: packMods(e),
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        size: anchorSize(rect, cols, rows),
        anyPressed: (e.buttons ?? 0) !== 0,
    });
}

function mouseButton(e: MouseEvent): number | null {
    switch (e.button) {
        case 0:
            return 0;
        case 1:
            return 1;
        case 2:
            return 2;
        default:
            return null;
    }
}
