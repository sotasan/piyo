import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type Props = {
    collapsed: boolean;
    onClick: () => void;
};

function FileTreeToggle({ collapsed, onClick }: Props) {
    const { t } = useTranslation();
    const icon = collapsed ? "icon-[lucide--folder]" : "icon-[lucide--folder-open]";
    return (
        <button
            type="button"
            aria-label={t(collapsed ? "fileTree.open" : "fileTree.close")}
            onClick={onClick}
            tabIndex={-1}
            data-tauri-drag-region={false}
            className="flex h-7 w-7 items-center justify-center rounded-full border-0 bg-transparent text-foreground hover:bg-foreground/10 hover:glass"
        >
            <span aria-hidden="true" className={cn(icon, "h-3.5 w-3.5")} />
        </button>
    );
}

export default FileTreeToggle;
