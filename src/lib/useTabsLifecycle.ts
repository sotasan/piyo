import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { installMenu } from "@/menu";
import { subscribeTabs, useTabsStore } from "@/stores/tabs";

export function useTabsLifecycle(): void {
    useEffect(() => {
        let cancelled = false;
        let unlistenPty: (() => void) | undefined;
        let uninstallMenu: (() => void) | undefined;
        let unsubStore: (() => void) | undefined;

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

            await useTabsStore.getState().spawn(null);
        })().catch((e) => console.error("tabs lifecycle startup failed", e));

        return () => {
            cancelled = true;
            unlistenPty?.();
            uninstallMenu?.();
            unsubStore?.();
        };
    }, []);
}
