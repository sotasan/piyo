/**
 * Lifecycle hook for an xterm.js terminal bound to one PTY rid.
 *
 * Creates the [`XtermTerminal`], loads addons, attaches the kitty-graphics
 * overlay, wires input/mouse/wheel listeners, subscribes to ghostty mode
 * changes, and pumps binary frames from the tab channel. Everything tears
 * down on `rid` change or unmount.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
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
import { onPtyModesChange } from "@/lib/ptyModes";
import { applyFrame, KIND_EXIT, KIND_FRAME } from "@/lib/xtermGhostty";
import {
    attachGraphicsOverlay,
    repaintOverlay,
    type GraphicsOverlay,
} from "@/lib/xtermGraphicsOverlay";
import { handleKey } from "@/lib/xtermInput";
import { getCellPx } from "@/lib/xtermInternals";
import { handleMouse, handleWheel } from "@/lib/xtermMouse";
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
            });
            termRef.current = term;
            cleanups.push(() => {
                term.dispose();
                termRef.current = null;
            });

            term.attachCustomKeyEventHandler((event) => {
                if (event.type === "keydown" && event.metaKey && event.key === "k") {
                    // Wipe xterm's scrollback then redraw the shell prompt
                    // by sending Ctrl-L. Mirrors macOS Terminal / iTerm.
                    term.clear();
                    void ptyWrite(rid, "\x0c");
                    return false;
                }
                if (event.type === "keydown" && event.metaKey && event.key === "f") {
                    triggerSearch();
                    return false;
                }
                const letXtermHandle = handleKey(rid, event);
                // When we intercept (handleKey returned false), xterm's input
                // path doesn't run and won't auto-scroll. Snap back to the
                // bottom on any keydown that produced input so the user sees
                // what they're typing.
                if (!letXtermHandle && event.type === "keydown") term.scrollToBottom();
                return letXtermHandle;
            });

            const fit = new FitAddon();
            const webFonts = new WebFontsAddon();
            const search = new SearchAddon();
            searchRef.current = search;
            for (const addon of [
                fit,
                webFonts,
                search,
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
            try {
                term.loadAddon(new WebglAddon());
            } catch {}
            fit.fit();
            ro.observe(container);

            const overlay: GraphicsOverlay | null = attachGraphicsOverlay(term);
            if (overlay) {
                const { canvas } = overlay;
                const scrollSub = term.onScroll(() => repaintOverlay(term, overlay));
                cleanups.push(() => {
                    scrollSub.dispose();
                    for (const p of overlay.placements.values()) p.marker.dispose();
                    overlay.placements.clear();
                    canvas.remove();
                });
            }

            const mouseHandler = (e: MouseEvent) => {
                handleMouse(rid, container, term.cols, term.rows, e);
            };
            // Capture-phase wheel handler: if the running app has mouse
            // tracking on, we encode the wheel as a mouse button event and
            // stop xterm's own wheel handling. Otherwise (no tracking),
            // we let xterm scroll its native scrollback.
            const wheelHandler = (e: WheelEvent) => {
                if (handleWheel(rid, container, term.cols, term.rows, e)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };
            container.addEventListener("wheel", wheelHandler, {
                passive: false,
                capture: true,
            });
            container.addEventListener("mousedown", mouseHandler);
            container.addEventListener("mouseup", mouseHandler);
            container.addEventListener("mousemove", mouseHandler);
            // Mirror ghostty's terminal modes into xterm + UI state.
            //  - mouseTracking: swap OS pointer (I-beam ↔ arrow)
            //  - bracketedPaste / focusEvent: propagate the DEC mode set
            //    escape to xterm so its native handling (paste wrapping,
            //    focus event emission) engages.
            const unsubTracking = onPtyModesChange(rid, (m) => {
                if (term.element) term.element.style.cursor = m.mouseTracking ? "default" : "";
                term.write(m.bracketedPaste ? "\x1b[?2004h" : "\x1b[?2004l");
                term.write(m.focusEvent ? "\x1b[?1004h" : "\x1b[?1004l");
            });
            cleanups.push(() => {
                container.removeEventListener("wheel", wheelHandler, { capture: true });
                container.removeEventListener("mousedown", mouseHandler);
                container.removeEventListener("mouseup", mouseHandler);
                container.removeEventListener("mousemove", mouseHandler);
                unsubTracking();
            });

            unsubChannel = useTabsStore.getState().subscribeToTab(rid, (event) => {
                if (ac.signal.aborted) return;
                const kind = new DataView(event).getUint8(0);
                if (kind === KIND_FRAME) {
                    applyFrame(term, event, overlay);
                } else if (kind === KIND_EXIT) {
                    term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
                }
            });

            const cellSize = () => {
                const { width, height } = getCellPx(term);
                return { cellWidth: width, cellHeight: height };
            };
            term.onData((data) => void ptyWrite(rid, data));
            term.onResize(({ cols, rows }) => {
                const cell = cellSize();
                void ptyResize(rid, cols, rows, cell.cellWidth, cell.cellHeight);
                emitResize(cols, rows);
            });

            const cell = cellSize();
            void ptyResize(rid, term.cols, term.rows, cell.cellWidth, cell.cellHeight);

            focusIfActive(term);
        })();

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
