import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const ACCENT_VAR = "--theme-accent";

function setAccent(hex: string): void {
    document.documentElement.style.setProperty(ACCENT_VAR, hex);
}

export async function applyAccent(): Promise<void> {
    const accent = await invoke<string>("get_accent_color");
    setAccent(accent);
}

export function subscribeAccent(): Promise<UnlistenFn> {
    return listen<string>("accent:changed", (e) => setAccent(e.payload));
}
