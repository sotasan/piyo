import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

import { i18next } from "@/lib/i18n";
import { useTabsStore } from "@/stores/tabs";

const t = (key: string, opts?: Record<string, unknown>) => i18next.t(`menu.${key}`, opts);

export async function installMenu(): Promise<() => void> {
    const appName = "Piyo";

    const aboutItem = await PredefinedMenuItem.new({
        item: { About: null },
        text: t("about", { name: appName }),
    });
    const services = await PredefinedMenuItem.new({ item: "Services" });
    const hideItem = await PredefinedMenuItem.new({
        item: "Hide",
        text: t("hide", { name: appName }),
    });
    const hideOthers = await PredefinedMenuItem.new({ item: "HideOthers" });
    const showAll = await PredefinedMenuItem.new({ item: "ShowAll" });
    const quitItem = await PredefinedMenuItem.new({
        item: "Quit",
        text: t("quit", { name: appName }),
    });
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });

    const piyoMenu = await Submenu.new({
        text: appName,
        items: [
            aboutItem,
            await sep(),
            services,
            await sep(),
            hideItem,
            hideOthers,
            showAll,
            await sep(),
            quitItem,
        ],
    });

    const undo = await PredefinedMenuItem.new({ item: "Undo" });
    const redo = await PredefinedMenuItem.new({ item: "Redo" });
    const cut = await PredefinedMenuItem.new({ item: "Cut" });
    const copy = await PredefinedMenuItem.new({ item: "Copy" });
    const paste = await PredefinedMenuItem.new({ item: "Paste" });
    const selectAll = await PredefinedMenuItem.new({ item: "SelectAll" });
    const editMenu = await Submenu.new({
        text: t("edit"),
        items: [undo, redo, await sep(), cut, copy, paste, selectAll],
    });

    const newTab = await MenuItem.new({
        id: "new-tab",
        text: t("newTab"),
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
        text: t("closeTab"),
        accelerator: "CmdOrCtrl+W",
        action: () => {
            const { activeId, close } = useTabsStore.getState();
            if (activeId !== null) close(activeId);
        },
    });
    const fileMenu = await Submenu.new({
        text: t("file"),
        items: [newTab, await sep(), closeTab],
    });

    const fullscreen = await PredefinedMenuItem.new({ item: "Fullscreen" });
    const viewMenu = await Submenu.new({
        text: t("view"),
        items: [fullscreen],
    });

    const minimize = await PredefinedMenuItem.new({ item: "Minimize" });
    const zoom = await PredefinedMenuItem.new({ item: "Maximize", text: t("zoom") });
    const bringAllToFront = await PredefinedMenuItem.new({ item: "BringAllToFront" });
    const prevTab = await MenuItem.new({
        id: "prev-tab",
        text: t("selectPrevTab"),
        accelerator: "Shift+CmdOrCtrl+BracketLeft",
        action: () => useTabsStore.getState().selectPrev(),
    });
    const nextTab = await MenuItem.new({
        id: "next-tab",
        text: t("selectNextTab"),
        accelerator: "Shift+CmdOrCtrl+BracketRight",
        action: () => useTabsStore.getState().selectNext(),
    });
    const showTabItems = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
            MenuItem.new({
                id: `show-tab-${i + 1}`,
                text: t("showTab", { index: i + 1 }),
                accelerator: `CmdOrCtrl+${i + 1}`,
                action: () => useTabsStore.getState().showAtIndex(i),
            }),
        ),
    );
    const windowMenu = await Submenu.new({
        text: t("window"),
        items: [
            minimize,
            zoom,
            await sep(),
            bringAllToFront,
            await sep(),
            prevTab,
            nextTab,
            await sep(),
            ...showTabItems,
        ],
    });

    const helpMenu = await Submenu.new({
        text: t("help"),
        items: [],
    });

    const menu = await Menu.new({
        items: [piyoMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu],
    });
    await menu.setAsAppMenu();
    await helpMenu.setAsHelpMenuForNSApp();

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
