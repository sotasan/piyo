import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef } from "react";

import "@xterm/xterm/css/xterm.css";
import { i18next } from "@/lib/i18n";
import { applyGhosttyFrame, type GraphicsOverlay } from "@/lib/xtermGhostty";
import { handleKey, handleMouse, handleWheel } from "@/lib/xtermInput";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";

type AppConfig = {
    font_family: string;
    font_size: number;
    theme: string;
    terminal: {
        padding: string;
    };
};

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
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const termRef = useRef<XtermTerminal | null>(null);

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
        let dispose: (() => void) | undefined;
        let unsubChannel: (() => void) | undefined;

        (async () => {
            const config = await invoke<AppConfig>("get_config");
            if (ac.signal.aborted) return;

            const term = new XtermTerminal({
                fontSize: config.font_size,
                fontFamily: fontStack(config.font_family),
                theme: buildTheme(),
                cursorBlink: true,
                quirks: { allowSetCursorBlink: true },
                scrollbar: { width: 8 },
                allowProposedApi: true,
                // Ghostty owns the scrollback. xterm.js just renders the
                // current viewport, so its own scrollback would be dead
                // memory.
                scrollback: 0,
            });
            termRef.current = term;
            term.attachCustomKeyEventHandler((event) => {
                if (event.type === "keydown" && event.metaKey && event.key === "k") {
                    invoke("pty_write", { rid, data: "\x0c" });
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
            dispose = () => {
                ro.disconnect();
                term.dispose();
                termRef.current = null;
            };

            await webFonts.loadFonts([FALLBACK_FONTS[0]]);
            if (ac.signal.aborted) return;

            term.open(container);
            if (term.element) term.element.style.padding = config.terminal.padding;
            try {
                term.loadAddon(new WebglAddon());
            } catch {}
            fit.fit();
            ro.observe(container);

            // Kitty graphics overlay canvas. xterm.js paints text into its own
            // canvases inside term.element; this one sits above them and is
            // driven directly from libghostty-vt's placement list. It's a child
            // of term.element so it inherits the padding offset.
            let overlay: GraphicsOverlay | null = null;
            if (term.element) {
                const canvas = document.createElement("canvas");
                canvas.style.position = "absolute";
                canvas.style.left = "0";
                canvas.style.top = "0";
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                canvas.style.pointerEvents = "none";
                canvas.style.zIndex = "5";
                // Start with a zero backing buffer; the painter resizes to the
                // parent's clientWidth/Height each frame.
                canvas.width = 0;
                canvas.height = 0;
                term.element.appendChild(canvas);
                canvasRef.current = canvas;
                overlay = { canvas, imageCache: new Map() };
                const prevDispose = dispose;
                dispose = () => {
                    canvas.remove();
                    canvasRef.current = null;
                    prevDispose?.();
                };
            }

            const wheelHandler = (event: WheelEvent) => {
                if (handleWheel(rid, event)) event.preventDefault();
            };
            const mouseHandler = (event: MouseEvent) => {
                handleMouse(rid, container, term.cols, term.rows, event);
            };
            container.addEventListener("wheel", wheelHandler, { passive: false });
            container.addEventListener("mousedown", mouseHandler);
            container.addEventListener("mouseup", mouseHandler);
            container.addEventListener("mousemove", mouseHandler);
            const prevDispose = dispose;
            dispose = () => {
                container.removeEventListener("wheel", wheelHandler);
                container.removeEventListener("mousedown", mouseHandler);
                container.removeEventListener("mouseup", mouseHandler);
                container.removeEventListener("mousemove", mouseHandler);
                prevDispose?.();
            };

            unsubChannel = useTabsStore.getState().subscribeToTab(rid, (event) => {
                if (ac.signal.aborted) return;
                if (event.kind === "frame") applyGhosttyFrame(term, event.data, overlay);
                else if (event.kind === "exit")
                    term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
            });
            // Pull device-independent cell dimensions out of xterm's render
            // service. libghostty-vt needs them to compute kitty graphics
            // placement pixel sizes; chafa specifies its image as C= / R=
            // grid cells, and without cell-px the rendered size collapses to
            // zero.
            const cellSize = () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const dims = (term as unknown as { _core: any })._core?._renderService?.dimensions
                    ?.css?.cell;
                return {
                    cellWidth: Math.max(1, Math.round((dims?.width as number) ?? 0)),
                    cellHeight: Math.max(1, Math.round((dims?.height as number) ?? 0)),
                };
            };
            term.onData((data) => invoke("pty_write", { rid, data }));
            term.onResize(({ cols, rows }) => {
                invoke("pty_resize", { rid, cols, rows, ...cellSize() });
                handleResize(cols, rows);
            });

            invoke("pty_resize", {
                rid,
                cols: term.cols,
                rows: term.rows,
                ...cellSize(),
            });

            focusIfActive(term);
        })();

        return () => {
            ac.abort();
            unsubChannel?.();
            dispose?.();
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
        </div>
    );
}

export default Terminal;
