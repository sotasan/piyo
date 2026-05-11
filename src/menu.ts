import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export type MenuState = {
    tabs: { id: number; title: string }[];
    activeId: number | null;
};

export type MenuActions = {
    newTab: () => void;
    closeActiveTab: () => void;
    selectPrevTab: () => void;
    selectNextTab: () => void;
    showTabAtIndex: (index: number) => void;
};

export async function installMenu(
    getState: () => MenuState,
    actions: MenuActions,
): Promise<() => Promise<void>> {
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
        action: () => actions.newTab(),
    });
    const closeTab = await MenuItem.new({
        id: "close-tab",
        text: "Close Tab",
        accelerator: "CmdOrCtrl+W",
        action: () => actions.closeActiveTab(),
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
        action: () => actions.selectPrevTab(),
    });
    const nextTab = await MenuItem.new({
        id: "next-tab",
        text: "Select Next Tab",
        accelerator: "Shift+CmdOrCtrl+BracketRight",
        action: () => actions.selectNextTab(),
    });
    const showTabItems = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
            MenuItem.new({
                id: `show-tab-${i + 1}`,
                text: `Show Tab ${i + 1}`,
                accelerator: `CmdOrCtrl+${i + 1}`,
                action: () => actions.showTabAtIndex(i),
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
        const { tabs, activeId } = getState();
        const hasActive = activeId !== null;
        const has2Plus = tabs.length >= 2;
        await closeTab.setEnabled(hasActive);
        await prevTab.setEnabled(has2Plus);
        await nextTab.setEnabled(has2Plus);
        for (let i = 0; i < showTabItems.length; i++) {
            await showTabItems[i].setEnabled(i < tabs.length);
        }
    };
    await refresh();
    return refresh;
}
