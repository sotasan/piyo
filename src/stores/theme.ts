import type { ITheme } from "@xterm/xterm";
import type { CSSProperties } from "react";
import { create } from "zustand";

export interface ResolvedTheme {
    name: string;
    type: "dark" | "light";
    xterm: ITheme;
    treeStyles: CSSProperties;
}

interface ThemeStore {
    theme: ResolvedTheme | null;
    set: (theme: ResolvedTheme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    theme: null,
    set: (theme) => set({ theme }),
}));
