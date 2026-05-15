import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { getAccentColor } from "@/ipc/commands";
import { onAccentChanged } from "@/ipc/events";

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
    useAccentStore.getState().set(await getAccentColor());
}

export function subscribeAccent(): Promise<UnlistenFn> {
    return onAccentChanged((hex) => useAccentStore.getState().set(hex));
}
