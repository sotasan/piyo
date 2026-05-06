import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

type PtyEvent =
  | { kind: "data"; data: number[] }
  | { kind: "exit" };
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

function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XtermTerminal({
      fontSize: 15,
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      theme: { background: "#1a1b26", foreground: "#a9b1d6" },
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const webFonts = new WebFontsAddon();
    term.loadAddon(fit);
    term.loadAddon(webFonts);
    term.loadAddon(new UnicodeGraphemesAddon());
    term.unicode.activeVersion = "15-graphemes";
    term.loadAddon(new ClipboardAddon());
    term.loadAddon(new ImageAddon());
    term.loadAddon(new ProgressAddon());
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        openUrl(uri);
      }),
    );

    let cancelled = false;
    const ro = new ResizeObserver(() => {
      setTimeout(() => {
        if (cancelled) return;
        try {
          fit.fit();
        } catch {}
      });
    });

    (async () => {
      await webFonts.loadFonts(["JetBrains Mono Variable"]);
      if (cancelled) return;
      term.open(container);
      if (term.element) {
        term.element.style.padding = "0 12px";
      }
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL unavailable — falls back to canvas
      }
      fit.fit();
      ro.observe(container);

      const events = new Channel<PtyEvent>();
      events.onmessage = (event) => {
        if (cancelled) return;
        if (event.kind === "data") {
          term.write(new Uint8Array(event.data));
        } else if (event.kind === "exit") {
          term.write("\r\n[process exited]\r\n");
        }
      };

      term.onData((data) => {
        invoke("pty_write", { data });
      });
      term.onResize(({ cols, rows }) => {
        invoke("pty_resize", { cols, rows });
      });

      await invoke("pty_spawn", { events, cols: term.cols, rows: term.rows });
    })();

    return () => {
      cancelled = true;
      ro.disconnect();
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-[#1a1b26]" />;
}

export default Terminal;
