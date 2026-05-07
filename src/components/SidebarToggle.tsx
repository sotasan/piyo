type Props = {
    collapsed: boolean;
    onClick: () => void;
};

function SidebarToggle({ collapsed, onClick }: Props) {
    const icon = collapsed ? "icon-[lucide--panel-left]" : "icon-[lucide--panel-left-close]";
    return (
        <button
            type="button"
            aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
            onClick={onClick}
            data-tauri-drag-region={false}
            className="w-7 h-7 flex items-center justify-center rounded-md border-0 bg-transparent text-foreground hover:bg-foreground/15"
        >
            <span aria-hidden="true" className={`${icon} w-3.5 h-3.5`} />
        </button>
    );
}

export default SidebarToggle;
