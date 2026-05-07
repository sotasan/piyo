import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { ProgressAddon } from "@xterm/addon-progress";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

type PtyEvent = { kind: "data"; data: number[] } | { kind: "exit" };

type AppConfig = {
    font_family: string;
    font_size: number;
    padding: string;
    theme: string;
};

const FALLBACK_FONTS = ["JetBrains Mono Variable", "ui-monospace", "monospace"];

function fontStack(family: string): string {
    return [family, ...FALLBACK_FONTS]
        .filter(Boolean)
        .map((f) => (f.includes(" ") ? `'${f}'` : f))
        .join(", ");
}

function readThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    const v = (name: string) => styles.getPropertyValue(name).trim();
    return {
        background: v("--theme-background"),
        foreground: v("--theme-foreground"),
        cursor: v("--theme-cursor"),
    };
}

function Terminal() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ac = new AbortController();
        let dispose: (() => void) | undefined;

        (async () => {
            const config = await invoke<AppConfig>("get_config");
            if (ac.signal.aborted) return;

            const term = new XtermTerminal({
                fontSize: config.font_size,
                fontFamily: fontStack(config.font_family),
                theme: readThemeColors(),
                cursorBlink: true,
                cursorStyle: "bar",
                allowProposedApi: true,
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
            };

            await webFonts.loadFonts([FALLBACK_FONTS[0]]);
            if (ac.signal.aborted) return;

            term.open(container);
            if (term.element) term.element.style.padding = config.padding;
            try {
                term.loadAddon(new WebglAddon());
            } catch {}
            fit.fit();
            ro.observe(container);

            const events = new Channel<PtyEvent>();
            events.onmessage = (event) => {
                if (ac.signal.aborted) return;
                if (event.kind === "data") term.write(new Uint8Array(event.data));
                else if (event.kind === "exit") term.write("\r\n[process exited]\r\n");
            };
            term.onData((data) => invoke("pty_write", { data }));
            term.onResize(({ cols, rows }) => invoke("pty_resize", { cols, rows }));
            term.buffer.onBufferChange((buf) => {
                term.options.cursorStyle = buf.type === "alternate" ? "block" : "bar";
            });

            await invoke("pty_spawn", { events, cols: term.cols, rows: term.rows });
        })();

        return () => {
            ac.abort();
            dispose?.();
        };
    }, []);

    return <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-background" />;
}

export default Terminal;
