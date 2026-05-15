import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";
import { getConfig, ptyResize, ptyWrite } from "@/ipc/commands";
import { i18next } from "@/lib/i18n";
import {
    applyFrame,
    attachGraphicsOverlay,
    KIND_EXIT,
    KIND_FRAME,
    type GraphicsOverlay,
} from "@/lib/xtermGhostty";
import { handleKey, handleMouse } from "@/lib/xtermInput";
import { getCellPx } from "@/lib/xtermInternals";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";

type Props = {
    rid: number;
    active: boolean;
    onResize?: (cols: number, rows: number) => void;
};

const FALLBACK_FONTS = ["JetBrains Mono Variable", "ui-monospace", "monospace"];
const SCROLLBACK_ROWS = 5000;

function fontStack(family: string): string {
    return [family, ...FALLBACK_FONTS]
        .filter(Boolean)
        .map((f) => (f.includes(" ") ? `'${f}'` : f))
        .join(", ");
}

function Terminal({ rid, active, onResize }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XtermTerminal | null>(null);
    const searchRef = useRef<SearchAddon | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const xtermTheme = useThemeStore((s) => s.theme?.xterm);

    const handleResize = useEffectEvent((cols: number, rows: number) => {
        onResize?.(cols, rows);
    });
    const focusIfActive = useEffectEvent((term: XtermTerminal) => {
        if (active) term.focus();
    });
    const buildTheme = useEffectEvent(() => xtermTheme);

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
                    void ptyWrite(rid, "\x0c");
                    return false;
                }
                if (event.type === "keydown" && event.metaKey && event.key === "f") {
                    setSearchOpen(true);
                    return false;
                }
                return handleKey(rid, event);
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
                const canvas = overlay.canvas;
                cleanups.push(() => canvas.remove());
            }

            const mouseHandler = (e: MouseEvent) => {
                handleMouse(rid, container, term.cols, term.rows, e);
            };
            container.addEventListener("mousedown", mouseHandler);
            container.addEventListener("mouseup", mouseHandler);
            container.addEventListener("mousemove", mouseHandler);
            cleanups.push(() => {
                container.removeEventListener("mousedown", mouseHandler);
                container.removeEventListener("mouseup", mouseHandler);
                container.removeEventListener("mousemove", mouseHandler);
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
                handleResize(cols, rows);
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

    return (
        <div
            className="absolute inset-0 overflow-hidden bg-background"
            style={{
                visibility: active ? "visible" : "hidden",
                pointerEvents: active ? "auto" : "none",
            }}
        >
            <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
            {searchOpen && (
                <div className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm shadow-lg glass">
                    <input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setSearchOpen(false);
                                setSearchQuery("");
                                searchRef.current?.clearDecorations();
                                termRef.current?.focus();
                            } else if (e.key === "Enter") {
                                if (e.shiftKey) searchRef.current?.findPrevious(searchQuery);
                                else searchRef.current?.findNext(searchQuery);
                            }
                        }}
                        placeholder="Search scrollback…"
                        className="w-56 bg-transparent text-foreground outline-none placeholder:text-foreground/40"
                    />
                </div>
            )}
        </div>
    );
}

export default Terminal;
