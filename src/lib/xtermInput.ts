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
 */
function macosShortcut(rid: number, e: KeyboardEvent): boolean {
    if (e.type !== "keydown") return false;
    if (e.metaKey && !e.ctrlKey && !e.altKey) {
        const seq = CMD_KEYS[e.key];
        if (seq !== undefined) {
            void ptyWrite(rid, seq);
            return true;
        }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const seq = OPT_KEYS[e.key];
        if (seq !== undefined) {
            void ptyWrite(rid, seq);
            return true;
        }
    }
    return false;
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

/** Tracks per-PTY mouse-tracking-on state so we can short-circuit motion
 *  events when the running app isn't listening for them. */
const trackingByRid = new Map<number, boolean>();

export function setMouseTracking(rid: number, tracking: boolean): void {
    trackingByRid.set(rid, tracking);
}

export function clearMouseTracking(rid: number): void {
    trackingByRid.delete(rid);
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
