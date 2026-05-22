import type { ITerminalAddon, Terminal } from "@xterm/xterm";

// Standalone forms of macOS dead keys (US International / ABNT / Spanish / etc).
// When compositionend commits one of these, the dead-key combination was
// cancelled by a non-combining next char rather than fused into a precomposed
// glyph — which is the WebKit quirk this addon repairs.
const DEAD_KEY_CHARS = new Set(["~", "`", "´", "¨", "^"]);

/**
 * Repair WebKit's dead-key cancellation quirks on Tauri/WKWebView.
 *
 * On macOS WKWebView, typing a dead key (e.g. Alt+N for ~) followed by a
 * non-combining char (`/`, `l`, …) produces:
 *   1. compositionend with data="~" — xterm's CompositionHelper schedules a
 *      setTimeout that reads the textarea and emits `~`. Correct.
 *   2. A synthetic keypress for the next physical key whose `charCode` is the
 *      dead char (126 for ~) rather than the actual key. xterm's `_keyPress`
 *      reads `charCode` first and emits `~` a second time. We suppress it.
 *   3. A keydown for the next physical key whose `event.key` is the
 *      concatenation "~/". xterm's keyboard service requires `key.length===1`
 *      so it ignores the keydown, and the input event is blocked by the
 *      `_keyDownSeen` guard — the actual key gets lost. We emit it directly.
 *
 * Chromium-based hosts (Tabby, Hyper) don't see (2)/(3), so xterm.js's stock
 * composition handling works there.
 *
 * Wire-up: load with `term.loadAddon(...)`, then call `handle(event)` from
 * your `attachCustomKeyEventHandler` callback and return `false` if it
 * returns `true`.
 */
export class WebKitDeadKeyAddon implements ITerminalAddon {
    private _commit: string | null = null;
    private _wasDead = false;
    private _textarea: HTMLTextAreaElement | null = null;
    private readonly _emit: (data: string) => void;

    constructor(emit: (data: string) => void) {
        this._emit = emit;
    }

    public activate(term: Terminal): void {
        this._textarea = term.textarea ?? null;
        this._textarea?.addEventListener("compositionend", this._onCompositionEnd, true);
    }

    public dispose(): void {
        this._textarea?.removeEventListener("compositionend", this._onCompositionEnd, true);
        this._textarea = null;
        this._commit = null;
        this._wasDead = false;
    }

    /** Returns `true` if the event was handled — caller should suppress xterm. */
    public handle(e: KeyboardEvent): boolean {
        if (
            e.type === "keypress" &&
            this._commit !== null &&
            e.charCode === this._commit.charCodeAt(0)
        ) {
            this._commit = null;
            this._wasDead = false;
            return true;
        }
        if (
            e.type === "keydown" &&
            this._wasDead &&
            this._commit !== null &&
            e.key.length === 2 &&
            e.key[0] === this._commit
        ) {
            this._emit(e.key.slice(1));
            return true;
        }
        return false;
    }

    private _onCompositionEnd = (e: Event): void => {
        const data = (e as CompositionEvent).data;
        this._commit = data || null;
        this._wasDead = !!data && DEAD_KEY_CHARS.has(data);
    };
}
