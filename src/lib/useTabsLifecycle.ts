import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { installMenu, type MenuState } from "@/menu";
import { getNewTabCwd, subscribeTabs, useTabsStore } from "@/stores/tabs";

export function useTabsLifecycle(): void {
    useEffect(() => {
        let cancelled = false;
        let unlistenPty: (() => void) | undefined;
        let unsubStore: (() => void) | undefined;

        (async () => {
            unlistenPty = await subscribeTabs();
            if (cancelled) {
                unlistenPty();
                return;
            }

            const getMenuState = (): MenuState => {
                const { tabs, activeId } = useTabsStore.getState();
                return { tabs: tabs.map(({ id, title }) => ({ id, title })), activeId };
            };
            const refresh = await installMenu(getMenuState, {
                newTab: () => {
                    useTabsStore
                        .getState()
                        .spawn(getNewTabCwd())
                        .catch((e) => console.error("spawn failed", e));
                },
                closeActiveTab: () => {
                    const { activeId, close } = useTabsStore.getState();
                    if (activeId !== null) close(activeId);
                },
                selectPrevTab: () => useTabsStore.getState().selectPrev(),
                selectNextTab: () => useTabsStore.getState().selectNext(),
                showTabAtIndex: (i) => useTabsStore.getState().showAtIndex(i),
            });
            if (cancelled) return;

            unsubStore = useTabsStore.subscribe((state, prev) => {
                if (state.tabs !== prev.tabs || state.activeId !== prev.activeId) {
                    refresh().catch((e) => console.error("menu refresh failed", e));
                }
                if (state.tabs.length === 0 && prev.tabs.length > 0) {
                    queueMicrotask(() => getCurrentWindow().close());
                }
            });

            await useTabsStore.getState().spawn(null);
        })().catch((e) => console.error("tabs lifecycle startup failed", e));

        return () => {
            cancelled = true;
            unlistenPty?.();
            unsubStore?.();
        };
    }, []);
}
