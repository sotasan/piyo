import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";

import { ptyResize, ptyWrite } from "@/ipc/commands";
import { i18next } from "@/lib/i18n";
import { applyFrame, KIND_BYTES, KIND_EXIT, KIND_FRAME } from "@/lib/xtermGhostty";
import { getCellPx } from "@/lib/xtermInternals";
import { useTabsStore } from "@/stores/tabs";

/**
 * Bridge between an xterm.js Terminal and the piyo PTY identified by `rid`.
 *
 * Owns four hot paths that all live or die with the terminal:
 *   1. PTY → term: subscribe to the ghostty-formatted binary channel
 *      (`KIND_BYTES` raw bytes, `KIND_FRAME` ghostty repaints, `KIND_EXIT`).
 *   2. term → PTY: forward xterm's `onData` to `ptyWrite`.
 *   3. Resize signaling: forward xterm's `onResize` to `ptyResize` and to
 *      the optional `onResize` callback for hosts that care.
 *   4. Initial size sync at activation, so the PTY learns the rendered
 *      cell size before the shell prints anything.
 *
 * Keeps the rid↔term coupling in one place; everything is torn down in
 * `dispose()`, which xterm's AddonManager calls from `Terminal.dispose()`.
 */
export class PtyBridgeAddon implements ITerminalAddon {
    private readonly _rid: number;
    private readonly _onResize?: (cols: number, rows: number) => void;
    private _unsubChannel?: () => void;
    private _disposables: IDisposable[] = [];

    constructor(rid: number, onResize?: (cols: number, rows: number) => void) {
        this._rid = rid;
        this._onResize = onResize;
    }

    public activate(term: Terminal): void {
        this._unsubChannel = useTabsStore.getState().subscribeToTab(this._rid, (event) => {
            const kind = new DataView(event).getUint8(0);
            if (kind === KIND_BYTES) {
                // Raw PTY bytes — feed xterm.js's parser so modes, OSC,
                // APC kitty graphics (addon-image), kitty keyboard, title,
                // and bell all keep working.
                term.write(new Uint8Array(event, 1));
            } else if (kind === KIND_FRAME) {
                // term.write() queues parsing onto the next tick. If we ran
                // applyFrame synchronously, line.getFg/getBg would return
                // stale attrs (xterm.js hasn't parsed the chunk's SGR
                // sequences yet) and moving the cursor to ghostty's position
                // would desync xterm.js's parser — its later writes would
                // land at the wrong cells. Defer via the write callback so
                // xterm.js drains first, then ghostty overwrites codepoints
                // in place.
                term.write("", () => applyFrame(term, event));
            } else if (kind === KIND_EXIT) {
                term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
            }
        });

        this._disposables.push(term.onData((data) => void ptyWrite(this._rid, data)));
        this._disposables.push(
            term.onResize(({ cols, rows }) => {
                const cell = getCellPx(term);
                void ptyResize(this._rid, cols, rows, cell.width, cell.height);
                this._onResize?.(cols, rows);
            }),
        );

        const cell = getCellPx(term);
        void ptyResize(this._rid, term.cols, term.rows, cell.width, cell.height);
    }

    public dispose(): void {
        this._unsubChannel?.();
        this._unsubChannel = undefined;
        for (const d of this._disposables) d.dispose();
        this._disposables = [];
    }
}
