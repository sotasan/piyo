import { Tooltip } from "@base-ui/react/tooltip";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useWorkspacesStore, type Workspace } from "@/stores/workspaces";

type Props = {
    workspace: Workspace;
    isActive: boolean;
    onActivate: (id: number) => void;
};

function workspaceLetter(path: string): string {
    const basename = path.split("/").filter(Boolean).pop() ?? "";
    return (basename[0] ?? "?").toUpperCase();
}

async function popRemoveMenu(workspaceId: number, label: string) {
    const item = await MenuItem.new({
        text: label,
        action: () => useWorkspacesStore.getState().remove(workspaceId),
    });
    const menu = await Menu.new({ items: [item] });
    try {
        await menu.popup();
    } finally {
        await Promise.all([item.close(), menu.close()]);
    }
}

function WorkspaceIcon({ workspace, isActive, onActivate }: Props) {
    const { t } = useTranslation();
    const label = workspace.isHome
        ? t("workspaces.homeLabel")
        : t("workspaces.workspaceLabel", { path: workspace.path });

    return (
        <Tooltip.Root>
            <Tooltip.Trigger
                render={
                    <button
                        type="button"
                        aria-label={label}
                        onClick={() => onActivate(workspace.id)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            if (workspace.isHome) return;
                            void popRemoveMenu(workspace.id, t("menu.removeWorkspace"));
                        }}
                        data-tauri-drag-region={false}
                        className={cn(
                            "size-8 flex items-center justify-center rounded-md text-xs font-semibold",
                            "border-0 bg-transparent text-foreground",
                            isActive
                                ? "glass bg-foreground/10"
                                : "hover:bg-foreground/10 hover:glass",
                        )}
                    >
                        {workspace.isHome ? (
                            <span aria-hidden className="icon-[lucide--house] size-4" />
                        ) : (
                            workspaceLetter(workspace.path)
                        )}
                    </button>
                }
            />
            <Tooltip.Portal>
                <Tooltip.Positioner side="right" sideOffset={8}>
                    <Tooltip.Popup className="rounded-md border border-border bg-background/80 px-2 py-1 text-xs text-foreground shadow-lg glass">
                        {workspace.path}
                    </Tooltip.Popup>
                </Tooltip.Positioner>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

export default WorkspaceIcon;
