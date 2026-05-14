import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";
import TerminalScrollbar from "@/components/TerminalScrollbar";
import { commands } from "@/gen/bindings";
import { i18next } from "@/lib/i18n";
import {
    applyFrame,
    attachGraphicsOverlay,
    KIND_EXIT,
    KIND_FRAME,
    type GraphicsOverlay,
    type ScrollInfo,
} from "@/lib/xtermGhostty";
import { handleKey, handleMouse, handleWheel } from "@/lib/xtermInput";
import { getCellPx } from "@/lib/xtermInternals";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";

type Props = {
    rid: number;
    active: boolean;
    onResize?: (cols: number, rows: number) => void;
};

const FALLBACK_FONTS = ["JetBrains Mono Variable", "ui-monospace", "monospace"];

function fontStack(family: string): string {
    return [family, ...FALLBACK_FONTS]
        .filter(Boolean)
        .map((f) => (f.includes(" ") ? `'${f}'` : f))
        .join(", ");
}

function Terminal({ rid, active, onResize }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XtermTerminal | null>(null);
    const [scrollInfo, setScrollInfo] = useState<ScrollInfo | null>(null);
    const [viewportRows, setViewportRows] = useState(24);

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
            const config = await commands.getConfig();
            if (ac.signal.aborted) return;

            const term = new XtermTerminal({
                fontSize: config.font_size,
                fontFamily: fontStack(config.font_family),
                theme: buildTheme(),
                cursorBlink: true,
                quirks: { allowSetCursorBlink: true },
                allowProposedApi: true,
                // Ghostty owns the scrollback; xterm.js just renders the
                // current viewport. Our own <TerminalScrollbar /> overlay
                // takes the place of xterm's native scrollbar.
                scrollback: 0,
            });
            termRef.current = term;
            cleanups.push(() => {
                term.dispose();
                termRef.current = null;
            });

            term.attachCustomKeyEventHandler((event) => {
                if (event.type === "keydown" && event.metaKey && event.key === "k") {
                    void commands.ptyWrite(rid, "\x0c");
                    return false;
                }
                return handleKey(rid, event);
            });

            const fit = new FitAddon();
            const webFonts = new WebFontsAddon();
            for (const addon of [
                fit,
                webFonts,
                new UnicodeGraphemesAddon(),
                new WebLinksAddon((event, uri) => {
                    event.preventDefault();
                    openUrl(uri);
                }),
            ]) {
                term.loadAddon(addon);
            }
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

            let overlay: GraphicsOverlay | null = attachGraphicsOverlay(term);
            if (overlay) {
                const canvas = overlay.canvas;
                cleanups.push(() => canvas.remove());
            }

            const wheelHandler = (e: WheelEvent) => {
                // Capture-phase + stopPropagation so xterm.js's wheel listener
                // (which converts wheel → arrow keys in alt-buffer mode) never
                // fires. Ghostty owns the viewport — trackpad must scroll the
                // scrollback, not type arrows into the running program.
                e.preventDefault();
                e.stopPropagation();
                handleWheel(rid, e);
            };
            const mouseHandler = (e: MouseEvent) => {
                handleMouse(rid, container, term.cols, term.rows, e);
            };
            container.addEventListener("wheel", wheelHandler, {
                passive: false,
                capture: true,
            });
            container.addEventListener("mousedown", mouseHandler);
            container.addEventListener("mouseup", mouseHandler);
            container.addEventListener("mousemove", mouseHandler);
            cleanups.push(() => {
                container.removeEventListener("wheel", wheelHandler, { capture: true });
                container.removeEventListener("mousedown", mouseHandler);
                container.removeEventListener("mouseup", mouseHandler);
                container.removeEventListener("mousemove", mouseHandler);
            });

            unsubChannel = useTabsStore.getState().subscribeToTab(rid, (event) => {
                if (ac.signal.aborted || !event) return;
                const kind = new DataView(event).getUint8(0);
                if (kind === KIND_FRAME) {
                    applyFrame(term, event, overlay, setScrollInfo);
                } else if (kind === KIND_EXIT) {
                    term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
                }
            });

            const cellSize = () => {
                const { width, height } = getCellPx(term);
                return { cellWidth: width, cellHeight: height };
            };
            term.onData((data) => void commands.ptyWrite(rid, data));
            term.onResize(({ cols, rows }) => {
                const cell = cellSize();
                void commands.ptyResize(rid, cols, rows, cell.cellWidth, cell.cellHeight);
                setViewportRows(rows);
                handleResize(cols, rows);
            });
            setViewportRows(term.rows);

            const cell = cellSize();
            void commands.ptyResize(rid, term.cols, term.rows, cell.cellWidth, cell.cellHeight);

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
            <TerminalScrollbar rid={rid} viewportRows={viewportRows} info={scrollInfo} />
        </div>
    );
}

export default Terminal;
