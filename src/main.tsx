import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "@fontsource-variable/jetbrains-mono/index.css";
import App from "./App";

const style = document.createElement("style");
style.textContent = await invoke<string>("get_theme_css");
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
