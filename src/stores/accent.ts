import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

const ACCENT_VAR = "--theme-accent";

interface AccentStore {
    hex: string;
    set: (hex: string) => void;
}

export const useAccentStore = create<AccentStore>((set) => ({
    hex: "transparent",
    set: (hex) => {
        document.documentElement.style.setProperty(ACCENT_VAR, hex);
        set({ hex });
    },
}));

export async function applyAccent(): Promise<void> {
    useAccentStore.getState().set(await invoke<string>("get_accent_color"));
}

export function subscribeAccent(): Promise<UnlistenFn> {
    return listen<string>("accent:changed", (e) => useAccentStore.getState().set(e.payload));
}
