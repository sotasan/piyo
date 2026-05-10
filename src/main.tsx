import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/jetbrains-mono/index.css";
import App from "@/App";
import { applyAccent, subscribeAccent } from "@/lib/services/accent";
import { applyThemeCss } from "@/lib/services/theme";
import { checkForUpdates } from "@/lib/services/updates";

await Promise.all([applyThemeCss(), applyAccent()]);
void subscribeAccent();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

await getCurrentWindow().show();

if (import.meta.env.PROD) void checkForUpdates();
