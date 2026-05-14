import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type Props = {
    collapsed: boolean;
    onClick: () => void;
};

function SidebarToggle({ collapsed, onClick }: Props) {
    const { t } = useTranslation();
    const icon = collapsed ? "icon-[lucide--panel-left]" : "icon-[lucide--panel-left-close]";
    return (
        <button
            type="button"
            aria-label={t(collapsed ? "sidebar.open" : "sidebar.close")}
            onClick={onClick}
            data-tauri-drag-region={false}
            className="flex h-7 w-7 items-center justify-center rounded-full border-0 bg-transparent text-foreground hover:bg-foreground/10 hover:glass"
        >
            <span aria-hidden="true" className={cn(icon, "h-3.5 w-3.5")} />
        </button>
    );
}

export default SidebarToggle;
