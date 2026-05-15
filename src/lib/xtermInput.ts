/**
 * Bridge browser keyboard events into the typed IPC key command.
 * Mode-dependent VT encoding happens in Rust against ghostty's encoders.
 */
import { ptySendKey, ptyWrite } from "@/ipc/commands";
import { ACTION_PRESS, ACTION_RELEASE, packMods } from "@/lib/inputModifiers";

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
