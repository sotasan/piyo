import type { ITerminalAddon, Terminal } from "@xterm/xterm";

/**
 * Repair WebKit's dead-key cancellation quirks on Tauri/WKWebView.
 *
 * Upstream: https://github.com/xtermjs/xterm.js/issues/5894 — remove this
 * addon once xterm.js handles it natively.
 *
 * On macOS WKWebView, typing a dead key (e.g. Alt+N for ~) followed by a
 * non-combining char (`/`, `l`, …) produces:
 *   1. compositionend with data="~" — xterm's CompositionHelper schedules a
 *      setTimeout that reads the textarea and emits `~`. Correct.
 *   2. A synthetic keypress for the next physical key whose `charCode` is
 *      the dead char (126 for ~) rather than the actual key. xterm's
 *      `_keyPress` reads `charCode` first and emits `~` a second time.
 *      We suppress it.
 *   3. A keydown for the next physical key whose `event.key` is the
 *      concatenation "~/". xterm's keyboard service requires
 *      `key.length===1` so it ignores the keydown, and the input event is
 *      blocked by the `_keyDownSeen` guard — the actual key gets lost.
 *      We emit it directly.
 *
 * Chromium-based hosts (Tabby, Hyper) don't see (2)/(3), so xterm.js's
 * stock composition handling works there. On Chromium our detection still
 * decides `_wasDead=false` (the Dead-keydown reset on `compositionstart`
 * wipes the marker before `compositionend`), so the suppression /
 * extraction never fires — which is correct, because the WebKit-specific
 * event shapes they'd match never appear there either.
 *
 * Dead-key detection: observe whether a `keydown` with `event.key ===
 * "Dead"` (or `"AltGraph"`) fires during the composition lifecycle, *not*
 * the committed char. Pattern-matching `compositionend.data` against a set
 * of "known dead chars" is fundamentally wrong because many layouts type
 * `~`, `^`, `` ` ``, etc. directly without ever going through a dead state
 * — see @jerch's analysis on the upstream issue.
 *
 * Wire-up: load with `term.loadAddon(...)`, then call `handle(event)` from
 * your `attachCustomKeyEventHandler` callback and return `false` if it
 * returns `true`.
 */
export class WebKitDeadKeyAddon implements ITerminalAddon {
    private _deadKeyDownSeen = false;
    private _commit: string | null = null;
    private _wasDead = false;
    private _textarea: HTMLTextAreaElement | null = null;
    private readonly _emit: (data: string) => void;

    constructor(emit: (data: string) => void) {
        this._emit = emit;
    }

    public activate(term: Terminal): void {
        this._textarea = term.textarea ?? null;
        this._textarea?.addEventListener("compositionstart", this._onCompositionStart, true);
        this._textarea?.addEventListener("compositionend", this._onCompositionEnd, true);
    }

    public dispose(): void {
        this._textarea?.removeEventListener("compositionstart", this._onCompositionStart, true);
        this._textarea?.removeEventListener("compositionend", this._onCompositionEnd, true);
        this._textarea = null;
        this._deadKeyDownSeen = false;
        this._commit = null;
        this._wasDead = false;
    }

    /** Returns `true` if the event was handled — caller should suppress xterm. */
    public handle(e: KeyboardEvent): boolean {
        // Note dead-key keydowns as they happen so compositionend can tell
        // a dead-key cancellation from any other composition commit. On
        // WebKit this keydown fires AFTER compositionstart but before
        // compositionend, so the flag is set in time.
        if (e.type === "keydown" && (e.key === "Dead" || e.key === "AltGraph")) {
            this._deadKeyDownSeen = true;
        }
        if (
            e.type === "keypress" &&
            this._wasDead &&
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

    private _onCompositionStart = (): void => {
        // Reset per-composition state. Also wipes any stale dead-key
        // marker from a prior composition whose keypress never arrived or
        // a Dead keydown that didn't lead to a composition.
        this._commit = null;
        this._wasDead = false;
        this._deadKeyDownSeen = false;
    };

    private _onCompositionEnd = (e: Event): void => {
        const data = (e as CompositionEvent).data;
        this._commit = data || null;
        this._wasDead = this._deadKeyDownSeen;
        this._deadKeyDownSeen = false;
    };
}
