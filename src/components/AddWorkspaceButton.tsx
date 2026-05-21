import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";

async function pickAndAddWorkspace() {
    const result = await open({ directory: true, multiple: false });
    if (typeof result !== "string") return;
    await useWorkspacesStore.getState().add(result);
}

function AddWorkspaceButton() {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            aria-label={t("workspaces.addLabel")}
            onClick={() => {
                void pickAndAddWorkspace().catch((e) => console.error("add workspace failed", e));
            }}
            data-tauri-drag-region={false}
            className={cn(
                "size-8 flex items-center justify-center rounded-md",
                "border-0 bg-transparent text-foreground/70",
                "hover:bg-foreground/10 hover:text-foreground hover:glass",
            )}
        >
            <span aria-hidden className="icon-[lucide--plus] size-4" />
        </button>
    );
}

export { pickAndAddWorkspace };
export default AddWorkspaceButton;
