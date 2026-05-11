import { invoke } from "@tauri-apps/api/core";

const STYLE_ID = "piyo-theme-css";

export async function applyThemeCss(): Promise<void> {
    const themeCss = await invoke<string>("get_theme_css");
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = themeCss;
}
