import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

await getCurrentWindow().show();
