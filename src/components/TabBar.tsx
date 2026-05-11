import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useFileIcon } from "@/hooks/icon";

type TabSummary = { id: number; title: string; cwd: string | null };

type Props = {
    tabs: TabSummary[];
    activeId: number | null;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
    onReorder: (oldIndex: number, newIndex: number) => void;
};

function SortableTab({
    tab,
    isActive,
    onActivate,
    onClose,
}: {
    tab: TabSummary;
    isActive: boolean;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tab.id,
    });
    const icon = useFileIcon(tab.cwd ?? "", 32);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
    };

    return (
        <button
            ref={setNodeRef}
            type="button"
            style={style}
            onClick={() => onActivate(tab.id)}
            {...attributes}
            {...listeners}
            className={[
                "group relative flex-1 min-w-[60px] max-w-[200px] h-7 rounded-md",
                "flex items-center justify-center px-6 text-xs select-none",
                "transition-colors",
                isActive
                    ? "bg-accent-dark/40 text-foreground"
                    : "text-foreground/60 hover:bg-accent-dark/20",
            ].join(" ")}
        >
            {icon && (
                <img
                    src={icon}
                    alt=""
                    className="pointer-events-none absolute top-1/2 left-1 size-4 -translate-y-1/2"
                />
            )}
            <span className="pointer-events-none truncate">{tab.title || "…"}</span>
            <span
                role="button"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
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
}

function TabBar({ tabs, activeId, onActivate, onClose, onReorder }: Props) {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = tabs.findIndex((t) => t.id === active.id);
        const newIndex = tabs.findIndex((t) => t.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onReorder(oldIndex, newIndex);
    };

    return (
        <div data-tauri-drag-region className="flex h-11 flex-1 items-center gap-1 px-1">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={tabs.map((t) => t.id)}
                    strategy={horizontalListSortingStrategy}
                >
                    {tabs.map((tab) => (
                        <SortableTab
                            key={tab.id}
                            tab={tab}
                            isActive={tab.id === activeId}
                            onActivate={onActivate}
                            onClose={onClose}
                        />
                    ))}
                </SortableContext>
            </DndContext>
        </div>
    );
}

export default TabBar;
