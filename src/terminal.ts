import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import "@xterm/xterm/css/xterm.css";
import { useWorkspaceStore } from "@/workspaceStore";

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

export class TerminalSession {
    readonly tabId: number;
    readonly ready: Promise<void>;
    term: XtermTerminal | null = null;
    fit: FitAddon | null = null;
    ptyId: number | null = null;

    private container: HTMLElement;
    private resizeObserver: ResizeObserver | null = null;
    private disposed = false;

    constructor(tabId: number, container: HTMLElement) {
        this.tabId = tabId;
        this.container = container;
        this.ready = this.init();
    }

    private async init() {
        const config = await invoke<AppConfig>("get_config");
        if (this.disposed) return;

        const term = new XtermTerminal({
            fontSize: config.font_size,
            fontFamily: fontStack(config.font_family),
            theme: readThemeColors(),
            cursorBlink: true,
            quirks: { allowSetCursorBlink: true },
            scrollbar: { width: 8 },
            allowProposedApi: true,
        });
        term.attachCustomKeyEventHandler((event) => {
            if (event.type === "keydown" && event.metaKey && event.key === "k") {
                if (this.ptyId == null) return false;
                term.write("\x1b[3J");
                invoke("pty_write", { id: this.ptyId, data: "\x0c" });
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

        await webFonts.loadFonts([FALLBACK_FONTS[0]]);
        if (this.disposed) {
            term.dispose();
            return;
        }

        term.open(this.container);
        if (term.element) term.element.style.padding = config.padding;
        try {
            term.loadAddon(new WebglAddon());
        } catch {}
        fit.fit();

        this.term = term;
        this.fit = fit;

        this.resizeObserver = new ResizeObserver(() => {
            setTimeout(() => {
                if (this.disposed) return;
                try {
                    fit.fit();
                } catch {}
            });
        });
        this.resizeObserver.observe(this.container);

        const events = new Channel<PtyEvent>();
        events.onmessage = (event) => {
            if (this.disposed) return;
            if (event.kind === "data") term.write(new Uint8Array(event.data));
            else if (event.kind === "exit") term.write("\r\n[process exited]\r\n");
        };
        term.onData((data) => {
            if (this.ptyId == null) return;
            invoke("pty_write", { id: this.ptyId, data });
        });
        term.onResize(({ cols, rows }) => {
            if (this.ptyId == null) return;
            invoke("pty_resize", { id: this.ptyId, cols, rows });
        });

        const id = await invoke<number>("pty_spawn", {
            events,
            cols: term.cols,
            rows: term.rows,
        });
        if (this.disposed) {
            invoke("pty_close", { id }).catch(() => {});
            return;
        }
        this.ptyId = id;
        useWorkspaceStore.getState().setTabPty(this.tabId, id);
    }

    focus() {
        this.term?.focus();
    }

    focusWhenReady(): () => void {
        let cancelled = false;
        this.ready.then(() => {
            if (!cancelled) this.term?.focus();
        });
        return () => {
            cancelled = true;
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.resizeObserver?.disconnect();
        this.term?.dispose();
        if (this.ptyId != null) {
            invoke("pty_close", { id: this.ptyId }).catch(() => {});
        }
    }
}

listen<{ id: number; title: string }>("pty:title", (e) => {
    useWorkspaceStore.getState().setTitle(e.payload.id, e.payload.title);
});
