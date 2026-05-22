import { openUrl } from "@tauri-apps/plugin-opener";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef } from "react";

import "@xterm/xterm/css/xterm.css";
import { getConfig, ptyResize, ptyWrite } from "@/ipc/commands";
import { i18next } from "@/lib/i18n";
import { WebKitDeadKeyAddon } from "@/lib/xtermDeadKey";
import { applyFrame, KIND_BYTES, KIND_EXIT, KIND_FRAME } from "@/lib/xtermGhostty";
import { handleKey } from "@/lib/xtermInput";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";

const FALLBACK_FONTS = ["JetBrains Mono Variable", "ui-monospace", "monospace"];
const SCROLLBACK_ROWS = 5000;

function fontStack(family: string): string {
    return [family, ...FALLBACK_FONTS]
        .filter(Boolean)
        .map((f) => (f.includes(" ") ? `'${f}'` : f))
        .join(", ");
}

function getCellPx(term: XtermTerminal): { width: number; height: number } {
    const cell = (
        term as unknown as {
            _core?: {
                _renderService?: {
                    dimensions?: { css?: { cell?: { width: number; height: number } } };
                };
            };
        }
    )._core?._renderService?.dimensions?.css?.cell;
    return {
        width: Math.max(1, Math.round(cell?.width ?? 0)),
        height: Math.max(1, Math.round(cell?.height ?? 0)),
    };
}

type UseXtermOptions = {
    rid: number;
    active: boolean;
    onResize?: (cols: number, rows: number) => void;
    onOpenSearch: () => void;
};

export type UseXtermResult = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    termRef: React.RefObject<XtermTerminal | null>;
    searchRef: React.RefObject<SearchAddon | null>;
};

export function useXterm({ rid, active, onResize, onOpenSearch }: UseXtermOptions): UseXtermResult {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XtermTerminal | null>(null);
    const searchRef = useRef<SearchAddon | null>(null);

    const xtermTheme = useThemeStore((s) => s.theme?.xterm);

    const emitResize = useEffectEvent((cols: number, rows: number) => {
        onResize?.(cols, rows);
    });
    const focusIfActive = useEffectEvent((term: XtermTerminal) => {
        if (active) term.focus();
    });
    const buildTheme = useEffectEvent(() => xtermTheme);
    const triggerSearch = useEffectEvent(() => {
        onOpenSearch();
    });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ac = new AbortController();
        const cleanups: Array<() => void> = [];
        let unsubChannel: (() => void) | undefined;

        (async () => {
            const config = await getConfig();
            if (ac.signal.aborted) return;

            const term = new XtermTerminal({
                fontSize: config.font_size,
                fontFamily: fontStack(config.font_family),
                theme: buildTheme(),
                cursorBlink: true,
                quirks: { allowSetCursorBlink: true },
                scrollbar: { width: 8 },
                allowProposedApi: true,
                scrollback: SCROLLBACK_ROWS,
                vtExtensions: { kittyKeyboard: true },
                // Ghostty owns reflow: on resize it repaints the visible grid
                // and signals scrollback evictions explicitly. xterm.js's own
                // reflow would wrap our already-rendered cells and dump the
                // interim rows into scrollback before ghostty's repaint
                // arrives. Setting windowsPty.buildNumber to a non-conpty
                // value flips xterm's internal _isReflowEnabled to false
                // (Buffer.ts) — the documented escape hatch for hosts that
                // own their own reflow.
                windowsPty: { buildNumber: 1 },
            });
            termRef.current = term;
            cleanups.push(() => {
                term.dispose();
                termRef.current = null;
            });

            // Construct now so the custom key handler can close over it; load
            // after term.open() since activate() reads term.textarea.
            const deadKey = new WebKitDeadKeyAddon((data) => void ptyWrite(rid, data));

            term.attachCustomKeyEventHandler((event) => {
                if (deadKey.handle(event)) return false;
                if (event.type === "keydown" && event.metaKey) {
                    if (event.key === "k") {
                        term.clear();
                        void ptyWrite(rid, "\x0c");
                        return false;
                    }
                    if (event.key === "f") {
                        triggerSearch();
                        return false;
                    }
                    // macOS Cmd+Arrow/Backspace/Delete readline shortcuts dispatch
                    // here. Everything else with Cmd (Cmd+T new tab, Cmd+W close,
                    // Cmd+V paste, etc.) we leave for the OS menu — returning false
                    // skips xterm's encoding so it doesn't preventDefault.
                    handleKey(rid, event);
                    return false;
                }
                return handleKey(rid, event);
            });

            const fit = new FitAddon();
            const webFonts = new WebFontsAddon();
            const search = new SearchAddon();
            const clipboard = new ClipboardAddon();
            const progress = new ProgressAddon();
            searchRef.current = search;
            for (const addon of [
                fit,
                webFonts,
                search,
                clipboard,
                progress,
                new UnicodeGraphemesAddon(),
                new WebLinksAddon((event, uri) => {
                    event.preventDefault();
                    openUrl(uri);
                }),
            ]) {
                term.loadAddon(addon);
            }
            cleanups.push(() => {
                searchRef.current = null;
            });
            term.unicode.activeVersion = "15-graphemes";

            const progressSub = progress.onChange((state) => {
                useTabsStore.getState().setProgress(rid, state);
            });
            cleanups.push(() => progressSub.dispose());

            const titleSub = term.onTitleChange((title) => {
                useTabsStore.getState().handleTitle(rid, title);
            });
            cleanups.push(() => titleSub.dispose());

            const ro = new ResizeObserver(() => {
                setTimeout(() => {
                    if (ac.signal.aborted) return;
                    try {
                        fit.fit();
                    } catch {}
                });
            });
            cleanups.push(() => ro.disconnect());

            await webFonts.loadFonts([FALLBACK_FONTS[0]]);
            if (ac.signal.aborted) return;

            term.open(container);
            if (term.element) term.element.style.padding = config.terminal.padding;
            term.loadAddon(deadKey);
            try {
                term.loadAddon(new LigaturesAddon());
            } catch (e) {
                console.warn("ligatures addon failed to load", e);
            }
            try {
                const webgl = new WebglAddon();
                webgl.onContextLoss(() => webgl.dispose());
                term.loadAddon(webgl);
            } catch {}
            try {
                term.loadAddon(new ImageAddon());
            } catch {}
            fit.fit();
            ro.observe(container);

            unsubChannel = useTabsStore.getState().subscribeToTab(rid, (event) => {
                if (ac.signal.aborted) return;
                const kind = new DataView(event).getUint8(0);
                if (kind === KIND_BYTES) {
                    // Raw PTY bytes — feed xterm.js's parser so modes, OSC,
                    // APC kitty graphics (addon-image), kitty keyboard,
                    // title, and bell all keep working.
                    term.write(new Uint8Array(event, 1));
                } else if (kind === KIND_FRAME) {
                    // term.write() queues parsing onto the next tick. If we
                    // ran applyFrame synchronously here, line.getFg/getBg
                    // would return stale attrs (xterm.js hasn't parsed the
                    // chunk's SGR sequences yet) and moving the cursor to
                    // ghostty's position would desync xterm.js's parser
                    // — its later writes would land at the wrong cells.
                    // Defer via the write callback so xterm.js drains
                    // first, then ghostty overwrites codepoints in place.
                    term.write("", () => applyFrame(term, event));
                } else if (kind === KIND_EXIT) {
                    term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
                }
            });

            term.onData((data) => void ptyWrite(rid, data));
            term.onResize(({ cols, rows }) => {
                const cell = getCellPx(term);
                void ptyResize(rid, cols, rows, cell.width, cell.height);
                emitResize(cols, rows);
            });

            const initialCell = getCellPx(term);
            void ptyResize(rid, term.cols, term.rows, initialCell.width, initialCell.height);

            focusIfActive(term);
        })().catch((e) => {
            if (!ac.signal.aborted) {
                console.error("xterm bootstrap failed", e);
                container.textContent = i18next.t("terminal.processExited");
            }
        });

        return () => {
            ac.abort();
            unsubChannel?.();
            for (const c of cleanups.reverse()) c();
        };
    }, [rid]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) return;
        term.options.theme = xtermTheme;
    }, [xtermTheme]);

    useEffect(() => {
        if (active) termRef.current?.focus();
    }, [active]);

    return { containerRef, termRef, searchRef };
}
