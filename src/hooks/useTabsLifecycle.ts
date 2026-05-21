import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";

import { ptyForegroundProcess } from "@/ipc/commands";
import { i18next } from "@/lib/i18n";
import { installMenu } from "@/lib/menu";
import { subscribeTabs, useTabsStore } from "@/stores/tabs";

async function anyTabBusyInWindow(): Promise<boolean> {
    const tabs = useTabsStore.getState().tabs;
    const results = await Promise.all(tabs.map((t) => ptyForegroundProcess(t.id)));
    return results.some((r) => r !== null);
}

export function useTabsLifecycle(): void {
    useEffect(() => {
        let cancelled = false;
        let unlistenPty: (() => void) | undefined;
        let uninstallMenu: (() => void) | undefined;
        let unsubStore: (() => void) | undefined;
        let unlistenClose: (() => void) | undefined;

        (async () => {
            unlistenPty = await subscribeTabs();
            if (cancelled) {
                unlistenPty();
                return;
            }

            uninstallMenu = await installMenu();
            if (cancelled) return;

            unsubStore = useTabsStore.subscribe((state, prev) => {
                if (state.tabs.length === 0 && prev.tabs.length > 0) {
                    queueMicrotask(() => getCurrentWindow().close());
                }
            });

            const win = getCurrentWindow();
            unlistenClose = await win.onCloseRequested(async (event) => {
                if (!(await anyTabBusyInWindow())) return;
                event.preventDefault();
                const ok = await ask(i18next.t("dialogs.closeWindow.body"), {
                    title: i18next.t("dialogs.closeWindow.title"),
                    kind: "warning",
                    okLabel: i18next.t("dialogs.closeWindow.ok"),
                    cancelLabel: i18next.t("dialogs.closeWindow.cancel"),
                });
                if (ok) await win.destroy();
            });
            if (cancelled) {
                unlistenClose();
                return;
            }

            await useTabsStore.getState().spawn(null);
        })().catch((e) => console.error("tabs lifecycle startup failed", e));

        return () => {
            cancelled = true;
            unlistenPty?.();
            uninstallMenu?.();
            unsubStore?.();
            unlistenClose?.();
        };
    }, []);
}
