import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

import { useTabsStore } from "@/stores/tabs";

export async function installMenu(): Promise<() => void> {
    const appName = "Piyo";

    const aboutItem = await PredefinedMenuItem.new({
        item: { About: null },
        text: `About ${appName}`,
    });
    const hideItem = await PredefinedMenuItem.new({ item: "Hide", text: `Hide ${appName}` });
    const hideOthers = await PredefinedMenuItem.new({ item: "HideOthers" });
    const showAll = await PredefinedMenuItem.new({ item: "ShowAll" });
    const quitItem = await PredefinedMenuItem.new({ item: "Quit", text: `Quit ${appName}` });
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });

    const piyoMenu = await Submenu.new({
        text: appName,
        items: [aboutItem, await sep(), hideItem, hideOthers, showAll, await sep(), quitItem],
    });

    const undo = await PredefinedMenuItem.new({ item: "Undo" });
    const redo = await PredefinedMenuItem.new({ item: "Redo" });
    const cut = await PredefinedMenuItem.new({ item: "Cut" });
    const copy = await PredefinedMenuItem.new({ item: "Copy" });
    const paste = await PredefinedMenuItem.new({ item: "Paste" });
    const selectAll = await PredefinedMenuItem.new({ item: "SelectAll" });
    const editMenu = await Submenu.new({
        text: "Edit",
        items: [undo, redo, await sep(), cut, copy, paste, await sep(), selectAll],
    });

    const newTab = await MenuItem.new({
        id: "new-tab",
        text: "New Tab",
        accelerator: "CmdOrCtrl+T",
        action: () => {
            useTabsStore
                .getState()
                .spawnSibling()
                .catch((e) => console.error("spawn failed", e));
        },
    });
    const closeTab = await MenuItem.new({
        id: "close-tab",
        text: "Close Tab",
        accelerator: "CmdOrCtrl+W",
        action: () => {
            const { activeId, close } = useTabsStore.getState();
            if (activeId !== null) close(activeId);
        },
    });
    const shellMenu = await Submenu.new({
        text: "Shell",
        items: [newTab, closeTab],
    });

    const minimize = await PredefinedMenuItem.new({ item: "Minimize" });
    const zoom = await PredefinedMenuItem.new({ item: "Maximize", text: "Zoom" });
    const prevTab = await MenuItem.new({
        id: "prev-tab",
        text: "Select Previous Tab",
        accelerator: "Shift+CmdOrCtrl+BracketLeft",
        action: () => useTabsStore.getState().selectPrev(),
    });
    const nextTab = await MenuItem.new({
        id: "next-tab",
        text: "Select Next Tab",
        accelerator: "Shift+CmdOrCtrl+BracketRight",
        action: () => useTabsStore.getState().selectNext(),
    });
    const showTabItems = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
            MenuItem.new({
                id: `show-tab-${i + 1}`,
                text: `Show Tab ${i + 1}`,
                accelerator: `CmdOrCtrl+${i + 1}`,
                action: () => useTabsStore.getState().showAtIndex(i),
            }),
        ),
    );
    const windowMenu = await Submenu.new({
        text: "Window",
        items: [minimize, zoom, await sep(), prevTab, nextTab, await sep(), ...showTabItems],
    });

    const menu = await Menu.new({
        items: [piyoMenu, editMenu, shellMenu, windowMenu],
    });
    await menu.setAsAppMenu();

    const refresh = async () => {
        const { tabs, activeId } = useTabsStore.getState();
        const hasActive = activeId !== null;
        const has2Plus = tabs.length >= 2;
        await Promise.all([
            closeTab.setEnabled(hasActive),
            prevTab.setEnabled(has2Plus),
            nextTab.setEnabled(has2Plus),
            ...showTabItems.map((item, i) => item.setEnabled(i < tabs.length)),
        ]);
    };
    await refresh();

    const unsub = useTabsStore.subscribe((state, prev) => {
        if (state.tabs !== prev.tabs || state.activeId !== prev.activeId) {
            refresh().catch((e) => console.error("menu refresh failed", e));
        }
    });

    return unsub;
}
