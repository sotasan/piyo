/**
 * Bridge browser keyboard events to libghostty-vt's key encoder.
 *
 * xterm.js encodes keystrokes using its own (now stale) parser state, so for
 * any key whose encoding depends on terminal modes (arrows, function keys,
 * keypad, etc.) we intercept the event and forward it to the Rust backend,
 * which uses [`libghostty_vt::key::Encoder`] to produce the correct VT bytes.
 *
 * Plain printable characters (no Ctrl/Alt/Meta) keep going through xterm's
 * normal `onData` path — their encoding is just the UTF-8 of the typed char,
 * independent of terminal modes, and letting xterm handle them preserves
 * IME composition.
 */
import { invoke } from "@tauri-apps/api/core";

/** Stable wire format mirrored in `src-tauri/src/input.rs`. */
const MOD_SHIFT = 1 << 0;
const MOD_CTRL = 1 << 1;
const MOD_ALT = 1 << 2;
const MOD_SUPER = 1 << 3;

const ACTION_PRESS = 0;
const ACTION_RELEASE = 1;
const MOUSE_ACTION_MOTION = 2;

/** `KeyboardEvent.key` values whose encoding depends on terminal modes. */
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

function packMods(e: KeyboardEvent): number {
    return (
        (e.shiftKey ? MOD_SHIFT : 0) |
        (e.ctrlKey ? MOD_CTRL : 0) |
        (e.altKey ? MOD_ALT : 0) |
        (e.metaKey ? MOD_SUPER : 0)
    );
}

function shouldIntercept(e: KeyboardEvent): boolean {
    // IME composition: never disturb xterm.js's textarea path — the composed
    // text arrives via `term.onData` → `pty_write` after compositionend.
    if (e.isComposing || e.keyCode === 229) return false;
    const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
    return hasModifier || SPECIAL_KEYS.has(e.key);
}

/**
 * Decide whether xterm.js's default handler should be suppressed and the
 * event sent to ghostty's encoder. Returns `false` to suppress xterm,
 * `true` to let xterm handle it as text input.
 *
 * Plain printable characters (no Ctrl/Alt/Meta) keep going through xterm's
 * normal `onData` path — their encoding is mode-independent and lets
 * xterm.js's textarea handle IME composition.
 */
export function handleKey(rid: number, e: KeyboardEvent): boolean {
    if (!shouldIntercept(e)) return true;
    const isPress = e.type === "keydown";
    const isRelease = e.type === "keyup";
    if (!isPress && !isRelease) return true;

    const text = isPress && e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : undefined;
    invoke("pty_send_key", {
        rid,
        code: e.code,
        mods: packMods(e),
        text,
        unshifted: e.key.length === 1 ? e.key.codePointAt(0) : undefined,
        action: isRelease ? ACTION_RELEASE : ACTION_PRESS,
    }).catch((err: unknown) => console.error("pty_send_key failed", err));

    return false;
}

/**
 * Forward mouse wheel scrolling to ghostty's viewport. Returns whether the
 * event was consumed (true → call preventDefault).
 */
export function handleWheel(rid: number, e: WheelEvent): boolean {
    if (e.deltaY === 0) return false;
    // One "notch" on most mice is deltaY≈100. Translate to ~3 rows so a
    // wheel click moves the viewport visibly without overshooting.
    const delta = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
    invoke("pty_scroll", { rid, delta }).catch((err: unknown) =>
        console.error("pty_scroll failed", err),
    );
    return true;
}

type Anchor = HTMLElement;

/** Map browser `MouseEvent.button` to libghostty's wire enum. */
function mouseButton(e: MouseEvent): number | undefined {
    switch (e.button) {
        case 0:
            return 0; // Left
        case 1:
            return 1; // Middle
        case 2:
            return 2; // Right
        default:
            return undefined;
    }
}

function mouseSize(anchor: Anchor) {
    const rect = anchor.getBoundingClientRect();
    return {
        screen_width: Math.max(1, Math.round(rect.width)),
        screen_height: Math.max(1, Math.round(rect.height)),
    };
}

function cellSize(anchor: Anchor, cols: number, rows: number) {
    const rect = anchor.getBoundingClientRect();
    return {
        cell_width: Math.max(1, Math.round(rect.width / Math.max(1, cols))),
        cell_height: Math.max(1, Math.round(rect.height / Math.max(1, rows))),
    };
}

/**
 * Forward a DOM mouse event to ghostty's mouse encoder. The Rust side checks
 * whether the terminal currently has mouse tracking on; if not, this is a
 * no-op so xterm.js's own selection still works for the user.
 */
export function handleMouse(
    rid: number,
    anchor: Anchor,
    cols: number,
    rows: number,
    e: MouseEvent,
    actionOverride?: number,
): void {
    const rect = anchor.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const action =
        actionOverride ??
        (e.type === "mousedown"
            ? ACTION_PRESS
            : e.type === "mouseup"
              ? ACTION_RELEASE
              : MOUSE_ACTION_MOTION);
    const size = { ...mouseSize(anchor), ...cellSize(anchor, cols, rows) };

    invoke("pty_send_mouse", {
        rid,
        input: {
            action,
            button: mouseButton(e),
            mods:
                (e.shiftKey ? MOD_SHIFT : 0) |
                (e.ctrlKey ? MOD_CTRL : 0) |
                (e.altKey ? MOD_ALT : 0) |
                (e.metaKey ? MOD_SUPER : 0),
            x,
            y,
            size,
            anyPressed: (e.buttons ?? 0) !== 0,
        },
    }).catch((err: unknown) => console.error("pty_send_mouse failed", err));
}
