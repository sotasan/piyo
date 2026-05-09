type TabSummary = { id: number; title: string };

type Props = {
    tabs: TabSummary[];
    activeId: number | null;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
};

function TabBar({ tabs, activeId, onActivate, onClose }: Props) {
    return (
        <div className="absolute inset-x-0 top-0 h-11 flex items-center px-1 gap-1">
            {tabs.map((tab) => {
                const isActive = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onActivate(tab.id)}
                        className={[
                            "group relative flex-1 min-w-[60px] max-w-[200px] h-7 rounded-md",
                            "flex items-center justify-center px-3 text-xs select-none",
                            "transition-colors",
                            isActive
                                ? "bg-accent-dark/40 text-foreground"
                                : "text-foreground/60 hover:bg-accent-dark/20",
                        ].join(" ")}
                    >
                        <span className="truncate pointer-events-none">{tab.title || "…"}</span>
                        <span
                            role="button"
                            aria-label="Close tab"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose(tab.id);
                            }}
                            className={[
                                "absolute right-1 top-1/2 -translate-y-1/2",
                                "size-4 flex items-center justify-center rounded-sm",
                                "opacity-0 group-hover:opacity-100",
                                "hover:bg-accent-dark/40",
                                "icon-[lucide--x] text-foreground/80",
                            ].join(" ")}
                        />
                    </button>
                );
            })}
        </div>
    );
}

export default TabBar;
