import { homeDir } from "@tauri-apps/api/path";
import { useEffect } from "react";

import { installMenu } from "@/lib/menu";
import { subscribeTabs, useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";

export function useTabsLifecycle(): void {
    useEffect(() => {
        let cancelled = false;
        let unlistenPty: (() => void) | undefined;
        let uninstallMenu: (() => void) | undefined;
        let unsubTabs: (() => void) | undefined;

        (async () => {
            unlistenPty = await subscribeTabs();
            if (cancelled) {
                unlistenPty();
                return;
            }

            uninstallMenu = await installMenu();
            if (cancelled) return;

            // Mirror the active tab id into the workspaces store so per-workspace
            // memory stays current when the user clicks a different tab.
            unsubTabs = useTabsStore.subscribe((state, prev) => {
                if (state.activeId === prev.activeId || state.activeId === null) return;
                const tab = state.tabs.find((t) => t.id === state.activeId);
                if (!tab) return;
                useWorkspacesStore.getState().setActiveTabFor(tab.workspaceId, tab.id);
            });

            const home = await homeDir();
            await useWorkspacesStore.getState().bootstrapHome(home);
        })().catch((e) => console.error("tabs lifecycle startup failed", e));

        return () => {
            cancelled = true;
            unlistenPty?.();
            uninstallMenu?.();
            unsubTabs?.();
        };
    }, []);
}
