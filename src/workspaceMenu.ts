import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { useWorkspaceStore } from "@/workspaceStore";

async function install() {
    const items = [
        await MenuItem.new({
            id: "ws_new",
            text: "New Workspace",
            accelerator: "Ctrl+T",
            action: () => useWorkspaceStore.getState().addWorkspace(),
        }),
        await MenuItem.new({
            id: "ws_close",
            text: "Close Workspace",
            accelerator: "Ctrl+W",
            action: () => {
                const { closeWorkspace, activeId } = useWorkspaceStore.getState();
                closeWorkspace(activeId);
            },
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
            id: "ws_prev",
            text: "Previous Workspace",
            accelerator: "CmdOrCtrl+Shift+[",
            action: () => useWorkspaceStore.getState().prev(),
        }),
        await MenuItem.new({
            id: "ws_next",
            text: "Next Workspace",
            accelerator: "CmdOrCtrl+Shift+]",
            action: () => useWorkspaceStore.getState().next(),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
    ];
    for (let n = 1; n <= 9; n++) {
        items.push(
            await MenuItem.new({
                id: `ws_switch_${n}`,
                text: `Switch to Workspace ${n}`,
                accelerator: `Ctrl+${n}`,
                action: () => useWorkspaceStore.getState().switchTo(n - 1),
            }),
        );
    }
    const submenu = await Submenu.new({ text: "Workspace", items });
    const menu = await Menu.default();
    await menu.append(submenu);
    await menu.setAsAppMenu();
}

install();
