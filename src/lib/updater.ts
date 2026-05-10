import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

import { i18next } from "@/lib/i18n";

export async function checkForUpdates(): Promise<void> {
    try {
        const update = await check();
        if (!update) return;
        const install = await ask(i18next.t("updates.prompt", { version: update.version }), {
            title: i18next.t("updates.title"),
            kind: "info",
            okLabel: i18next.t("updates.install"),
            cancelLabel: i18next.t("updates.later"),
        });
        if (install) {
            await update.downloadAndInstall();
            await relaunch();
        }
    } catch (e) {
        console.warn("update check failed", e);
    }
}
