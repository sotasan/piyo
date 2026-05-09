import type { Workspace } from "@/workspaces";

type Props = {
    workspaces: Workspace[];
    activeId: number;
    titles: Record<number, string>;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
};

function Sidebar({ workspaces, activeId, titles, onActivate, onClose }: Props) {
    return (
        <aside className="h-full bg-transparent flex flex-col items-center py-2 gap-1.5">
            {workspaces.map((ws, i) => {
                const activeTab = ws.tabs.find((t) => t.id === ws.activeTabId);
                const title =
                    (activeTab?.ptyId != null ? titles[activeTab.ptyId] : undefined) ||
                    `Workspace ${i + 1}`;
                const active = ws.id === activeId;
                return (
                    <div key={ws.id} className="relative group">
                        <button
                            type="button"
                            onClick={() => onActivate(ws.id)}
                            title={title}
                            aria-label={title}
                            aria-current={active ? "true" : undefined}
                            className={`w-8 h-8 rounded-md flex items-center justify-center text-xs select-none ${
                                active
                                    ? "bg-foreground/15 ring-1 ring-foreground/30 text-foreground"
                                    : "text-foreground/70 hover:bg-foreground/10"
                            }`}
                        >
                            {i < 9 ? (
                                i + 1
                            ) : (
                                <span aria-hidden className="icon-[lucide--terminal] w-3.5 h-3.5" />
                            )}
                        </button>
                        {workspaces.length > 1 && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose(ws.id);
                                }}
                                aria-label={`Close ${title}`}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border border-border opacity-0 group-hover:opacity-100 flex items-center justify-center"
                            >
                                <span aria-hidden className="icon-[lucide--x] w-2.5 h-2.5" />
                            </button>
                        )}
                    </div>
                );
            })}
        </aside>
    );
}

export default Sidebar;
