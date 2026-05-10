import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export async function checkForUpdates(): Promise<void> {
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
    } catch (e) {
        console.warn("update check failed", e);
    }
}
