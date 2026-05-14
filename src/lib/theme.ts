import type { ITheme } from "@xterm/xterm";
import { bundledThemes, type BundledTheme } from "shiki";

import { commands } from "@/gen/bindings";
import { useThemeStore } from "@/stores/theme";

const DEFAULT_THEME: BundledTheme = "rose-pine";

// Minimal shape for VS Code theme JSON (avoids coupling to shiki's exact type
// name, which has churned across versions: ThemeRegistration / *Any / *Resolved).
interface ShikiTheme {
    name?: string;
    type?: "dark" | "light";
    colors?: Record<string, string>;
    fg?: string;
    bg?: string;
}

const ANSI_KEYS = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
] as const;
type AnsiKey = (typeof ANSI_KEYS)[number];

function workbenchKey(ansi: AnsiKey): string {
    if (ansi.startsWith("bright")) {
        // "brightRed" -> "Red"
        return `terminal.ansiBright${ansi.slice(6)}`;
    }
    return `terminal.ansi${ansi.charAt(0).toUpperCase() + ansi.slice(1)}`;
}

function cssVarForAnsi(ansi: AnsiKey): string {
    // "brightRed" -> "--theme-ansi-bright-red"
    const dashed = ansi.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    return `--theme-ansi-${dashed}`;
}

function pick(colors: Record<string, string>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = colors[k];
        if (v) return v;
    }
    return undefined;
}

async function loadTheme(name: string): Promise<ShikiTheme> {
    const userJson = await commands.readUserTheme(name);
    if (userJson) {
        try {
            return JSON.parse(userJson) as ShikiTheme;
        } catch (err) {
            console.warn(`piyo: user theme "${name}" is not valid JSON; falling back`, err);
        }
    }

    const key = (name in bundledThemes ? name : DEFAULT_THEME) as BundledTheme;
    const mod = await bundledThemes[key]();
    return mod.default as ShikiTheme;
}

export async function applyTheme(name: string): Promise<void> {
    const theme = await loadTheme(name);
    const colors = (theme.colors ?? {}) as Record<string, string>;

    const background =
        pick(colors, ["terminal.background", "editor.background"]) ?? theme.bg ?? "#000000";
    const foreground =
        pick(colors, ["terminal.foreground", "editor.foreground"]) ?? theme.fg ?? "#ffffff";
    const cursor =
        pick(colors, ["terminalCursor.foreground", "editorCursor.foreground"]) ?? foreground;
    const border = pick(colors, ["panel.border", "contrastBorder", "editorGroup.border"]);
    const selection = pick(colors, ["terminal.selectionBackground", "editor.selectionBackground"]);

    const root = document.documentElement;
    root.style.setProperty("--theme-background", background);
    root.style.setProperty("--theme-foreground", foreground);
    root.style.setProperty("--theme-cursor", cursor);
    root.style.setProperty(
        "--theme-border",
        border ?? `color-mix(in oklab, ${foreground} 20%, transparent)`,
    );
    if (selection) root.style.setProperty("--theme-selection", selection);
    else root.style.removeProperty("--theme-selection");

    const xterm: ITheme = {
        background,
        foreground,
        cursor,
        cursorAccent: background,
        selectionBackground: selection,
    };

    for (const ansi of ANSI_KEYS) {
        const value = colors[workbenchKey(ansi)];
        const cssVar = cssVarForAnsi(ansi);
        if (value) {
            root.style.setProperty(cssVar, value);
            (xterm as Record<string, string | undefined>)[ansi] = value;
        } else {
            root.style.removeProperty(cssVar);
        }
    }

    const mode: "light" | "dark" = theme.type === "light" ? "light" : "dark";
    root.style.colorScheme = mode;

    const appearance = await commands.setWindowAppearance(mode);
    if (appearance.status === "error") {
        console.warn("piyo: failed to set native window appearance", appearance.error);
    }

    useThemeStore.getState().set({
        name: theme.name ?? name,
        type: mode,
        xterm,
    });
}
