import { getCurrentWindow } from "@tauri-apps/api/window";
import { locale } from "@tauri-apps/plugin-os";
import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/jetbrains-mono/index.css";
import App from "@/App";
import { commands } from "@/gen/bindings";
import { initI18n } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";
import { checkForUpdates } from "@/lib/updater";
import { applyAccent, subscribeAccent } from "@/stores/accent";

const config = await commands.getConfig();
const [, , detectedLocale] = await Promise.all([applyTheme(config.theme), applyAccent(), locale()]);
await initI18n(detectedLocale);
void subscribeAccent();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

await getCurrentWindow().show();

if (import.meta.env.PROD) void checkForUpdates();
