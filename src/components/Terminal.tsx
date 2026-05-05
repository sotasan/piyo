import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { init, Terminal as GhosttyTerminal } from "ghostty-web";

function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let term: GhosttyTerminal | undefined;
    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      await init();
      if (cancelled || !containerRef.current) return;

      term = new GhosttyTerminal({
        fontSize: 14,
        theme: { background: "#1a1b26", foreground: "#a9b1d6" },
      });
      term.open(containerRef.current);

      unlistenData = await listen<number[]>("pty:data", (event) => {
        term?.write(new Uint8Array(event.payload));
      });
      unlistenExit = await listen("pty:exit", () => {
        term?.write("\r\n[process exited]\r\n");
      });

      term.onData((data) => {
        invoke("pty_write", { data });
      });
      term.onResize(({ cols, rows }) => {
        invoke("pty_resize", { cols, rows });
      });

      await invoke("pty_spawn", { cols: term.cols, rows: term.rows });
    })();

    return () => {
      cancelled = true;
      unlistenData?.();
      unlistenExit?.();
      term?.dispose();
    };
  }, []);

  return <div ref={containerRef} className="terminal" />;
}

export default Terminal;
