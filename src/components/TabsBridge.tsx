import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { installMenu, type MenuState } from "@/menu";
import { getNewTabCwd, subscribeTabs, useTabsStore } from "@/stores/tabs";

// Owns the tab system's side effects so App.tsx can stay layout-only:
// pty event subscriptions, app menu installation + menu-action wiring,
// the initial tab spawn, and closing the window when the last tab exits.
function TabsBridge() {
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
        })().catch((e) => console.error("tabs bridge startup failed", e));

        return () => {
            cancelled = true;
            unlistenPty?.();
            unsubStore?.();
        };
    }, []);

    return null;
}

export default TabsBridge;
