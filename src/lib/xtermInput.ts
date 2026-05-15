/**
 * Bridge browser keyboard / mouse events into the typed IPC commands.
 * Mode-dependent VT encoding happens in Rust against ghostty's encoders.
 */
import { ptySendKey, ptySendMouse, ptyWrite } from "@/ipc/commands";

// Mirrors `libghostty_vt::key::Mods` bit values (shift/ctrl/alt/super =
// 1/2/4/8). The Rust side ANDs against the supported bits, so anything we
// pack here is fine.
const MOD_SHIFT = 1 << 0;
const MOD_CTRL = 1 << 1;
const MOD_ALT = 1 << 2;
const MOD_SUPER = 1 << 3;

const ACTION_PRESS = 0;
const ACTION_RELEASE = 1;
const MOUSE_ACTION_MOTION = 2;

const SPECIAL_KEYS = new Set<string>([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Insert",
    "Delete",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
    "F13",
    "F14",
    "F15",
    "F16",
    "F17",
    "F18",
    "F19",
    "F20",
]);

function packMods(e: {
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}): number {
    return (
        (e.shiftKey ? MOD_SHIFT : 0) |
        (e.ctrlKey ? MOD_CTRL : 0) |
        (e.altKey ? MOD_ALT : 0) |
        (e.metaKey ? MOD_SUPER : 0)
    );
}

function shouldIntercept(e: KeyboardEvent): boolean {
    if (e.isComposing || e.keyCode === 229) return false;
    return e.ctrlKey || e.altKey || e.metaKey || SPECIAL_KEYS.has(e.key);
}

/**
 * macOS keyboard conventions that don't map to standard VT sequences.
 * Shells (readline-style) expect raw control bytes here, not CSI codes:
 *   Cmd+Left  → ^A  (start of line)        Option+Left  → ESC b  (word back)
 *   Cmd+Right → ^E  (end of line)          Option+Right → ESC f  (word fwd)
 *   Cmd+Backspace → ^U (kill to start)     Option+Backspace → ^W  (kill word)
 *   Cmd+Delete    → ^K (kill to end)       Option+Delete    → ESC d (kill word fwd)
 *
 * Returns true if the key matches a shortcut (caller should suppress xterm).
 * Sends the readline byte on keydown only; keyup is swallowed so ghostty's
 * encoder doesn't see a release event for a press it never saw.
 */
function macosShortcut(rid: number, e: KeyboardEvent): boolean {
    const isCmd = e.metaKey && !e.ctrlKey && !e.altKey;
    const isOpt = e.altKey && !e.ctrlKey && !e.metaKey;
    const seq = isCmd ? CMD_KEYS[e.key] : isOpt ? OPT_KEYS[e.key] : undefined;
    if (seq === undefined) return false;
    if (e.type === "keydown") void ptyWrite(rid, seq);
    return true;
}

const CMD_KEYS: Record<string, string> = {
    ArrowLeft: "\x01",
    ArrowRight: "\x05",
    Backspace: "\x15",
    Delete: "\x0b",
};
const OPT_KEYS: Record<string, string> = {
    ArrowLeft: "\x1bb",
    ArrowRight: "\x1bf",
    Backspace: "\x17",
    Delete: "\x1bd",
};

/** Returns `true` to let xterm handle the event as text, `false` to suppress. */
export function handleKey(rid: number, e: KeyboardEvent): boolean {
    if (!shouldIntercept(e)) return true;
    if (macosShortcut(rid, e)) return false;
    const isPress = e.type === "keydown";
    const isRelease = e.type === "keyup";
    if (!isPress && !isRelease) return true;
    void ptySendKey(rid, {
        code: e.code,
        mods: packMods(e),
        text: isPress && e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : null,
        unshifted: e.key.length === 1 ? (e.key.codePointAt(0) ?? null) : null,
        action: isRelease ? ACTION_RELEASE : ACTION_PRESS,
    });
    return false;
}

export type MouseAnchor = HTMLElement;

/** Pixels of trackpad scroll per emitted wheel click. Trackpads on macOS
 *  fire many tiny per-frame deltas; without accumulation a single swipe
 *  emits dozens of wheel events. Tuned to feel like ghostty's default. */
const PIXELS_PER_WHEEL_CLICK = 80;
let wheelAccum = 0;

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
        wheelAccum += e.deltaY;
        clicks = Math.trunc(wheelAccum / PIXELS_PER_WHEEL_CLICK);
        if (clicks === 0) return true;
        wheelAccum -= clicks * PIXELS_PER_WHEEL_CLICK;
    } else {
        clicks = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY)));
    }

    const rect = anchor.getBoundingClientRect();
    const button = clicks < 0 ? 3 : 4; // Four = up, Five = down
    const size = {
        screenWidth: Math.max(1, Math.round(rect.width)),
        screenHeight: Math.max(1, Math.round(rect.height)),
        cellWidth: Math.max(1, Math.round(rect.width / Math.max(1, cols))),
        cellHeight: Math.max(1, Math.round(rect.height / Math.max(1, rows))),
    };
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

/** Tracks per-PTY mouse-tracking-on state so we can short-circuit motion
 *  events when the running app isn't listening for them, and so the UI
 *  can swap the mouse pointer between I-beam and arrow. */
const trackingByRid = new Map<number, boolean>();
const trackingListeners = new Map<number, (tracking: boolean) => void>();

export function setMouseTracking(rid: number, tracking: boolean): void {
    if (trackingByRid.get(rid) === tracking) return;
    trackingByRid.set(rid, tracking);
    trackingListeners.get(rid)?.(tracking);
}

export function clearMouseTracking(rid: number): void {
    trackingByRid.delete(rid);
    trackingListeners.delete(rid);
}

/** Subscribe to mouse-tracking state changes for one rid. The callback
 *  fires only on transitions. */
export function onMouseTrackingChange(rid: number, cb: (tracking: boolean) => void): () => void {
    trackingListeners.set(rid, cb);
    return () => {
        if (trackingListeners.get(rid) === cb) trackingListeners.delete(rid);
    };
}

function isTracking(rid: number): boolean {
    return trackingByRid.get(rid) === true;
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
        size: {
            screenWidth: Math.max(1, Math.round(rect.width)),
            screenHeight: Math.max(1, Math.round(rect.height)),
            cellWidth: Math.max(1, Math.round(rect.width / Math.max(1, cols))),
            cellHeight: Math.max(1, Math.round(rect.height / Math.max(1, rows))),
        },
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
