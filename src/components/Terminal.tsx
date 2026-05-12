import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { ProgressAddon } from "@xterm/addon-progress";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useEffectEvent, useRef } from "react";

import "@xterm/xterm/css/xterm.css";
import { i18next } from "@/lib/i18n";
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
            });
            termRef.current = term;
            term.attachCustomKeyEventHandler((event) => {
                if (event.type === "keydown" && event.metaKey && event.key === "k") {
                    term.write("\x1b[3J");
                    invoke("pty_write", { rid, data: "\x0c" });
                    return false;
                }
                return true;
            });
            const fit = new FitAddon();
            const webFonts = new WebFontsAddon();
            for (const addon of [
                fit,
                webFonts,
                new UnicodeGraphemesAddon(),
                new ClipboardAddon(),
                new ImageAddon(),
                new ProgressAddon(),
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

            unsubChannel = useTabsStore.getState().subscribeToTab(rid, (event) => {
                if (ac.signal.aborted) return;
                if (event.kind === "data") term.write(new Uint8Array(event.data));
                else if (event.kind === "exit")
                    term.write(`\r\n${i18next.t("terminal.processExited")}\r\n`);
            });
            term.onData((data) => invoke("pty_write", { rid, data }));
            term.onResize(({ cols, rows }) => {
                invoke("pty_resize", { rid, cols, rows });
                handleResize(cols, rows);
            });

            invoke("pty_resize", { rid, cols: term.cols, rows: term.rows });

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
