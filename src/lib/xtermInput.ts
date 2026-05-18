import { platform } from "@tauri-apps/plugin-os";

import { ptyWrite } from "@/ipc/commands";

const IS_MACOS = platform() === "macos";

const CMD_KEYS: Record<string, string> = {
    ArrowLeft: "\x01",
    ArrowRight: "\x05",
    Backspace: "\x15",
    Delete: "\x0b",
};
const OPT_KEYS: Record<string, string> = {
    ArrowLeft: "\x1bb",
    ArrowRight: "\x1bf",
    Backspace: "\x17",
    Delete: "\x1bd",
};

/** Returns `true` to let xterm handle the event, `false` to suppress. */
export function handleKey(rid: number, e: KeyboardEvent): boolean {
    if (e.type !== "keydown" || !IS_MACOS) return true;
    const isCmd = e.metaKey && !e.ctrlKey && !e.altKey;
    const isOpt = e.altKey && !e.ctrlKey && !e.metaKey;
    const seq = isCmd ? CMD_KEYS[e.key] : isOpt ? OPT_KEYS[e.key] : undefined;
    if (seq === undefined) return true;
    void ptyWrite(rid, seq);
    return false;
}
