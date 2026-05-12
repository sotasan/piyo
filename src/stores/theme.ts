import type { ITheme } from "@xterm/xterm";
import { create } from "zustand";

export interface ResolvedTheme {
    name: string;
    type: "dark" | "light";
    xterm: ITheme;
}

interface ThemeStore {
    theme: ResolvedTheme | null;
    set: (theme: ResolvedTheme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    theme: null,
    set: (theme) => set({ theme }),
}));
