import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import "@fontsource-variable/jetbrains-mono/index.css";
import App from "@/App";

const [themeCss, accent] = await Promise.all([
    invoke<string>("get_theme_css"),
    invoke<string>("get_accent_color"),
]);
const style = document.createElement("style");
style.textContent = themeCss;
document.head.appendChild(style);
document.documentElement.style.setProperty("--theme-accent", accent);

listen<string>("accent:changed", (e) => {
    document.documentElement.style.setProperty("--theme-accent", e.payload);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

await getCurrentWindow().show();

if (import.meta.env.PROD) {
    void (async () => {
        try {
            const update = await check();
            if (!update) return;
            const install = await ask(`Piyo ${update.version} is available. Install now?`, {
                title: "Update available",
                kind: "info",
                okLabel: "Install",
                cancelLabel: "Later",
            });
            if (install) {
                await update.downloadAndInstall();
                await relaunch();
            }
        } catch {}
    })();
}
