import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { commands, events } from "@/gen/bindings";

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
    useAccentStore.getState().set(await commands.getAccentColor());
}

export function subscribeAccent(): Promise<UnlistenFn> {
    return events.accentChanged.listen((e) => useAccentStore.getState().set(e.payload));
}
