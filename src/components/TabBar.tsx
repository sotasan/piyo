import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef } from "react";

import TabTitle from "@/components/TabTitle";
import { useTabsStore } from "@/stores/tabs";

type TabSummary = { id: number; title: string };

type Props = {
    tabs: TabSummary[];
    activeId: number | null;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
    onReorder: (oldIndex: number, newIndex: number) => void;
};

type SortableTabProps = {
    tab: TabSummary;
    isActive: boolean;
    onActivate: (id: number) => void;
    onClose: (id: number) => void;
};

function SortableTab({ tab, isActive, onActivate, onClose }: SortableTabProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tab.id,
    });
    const cwd = useTabsStore((s) => s.cwds.get(tab.id) ?? "");
    const nodeRef = useRef<HTMLButtonElement | null>(null);
    const setRefs = (el: HTMLButtonElement | null) => {
        setNodeRef(el);
        nodeRef.current = el;
    };

    useEffect(() => {
        if (isActive) {
            nodeRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest",
            });
        }
    }, [isActive]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
    };

    return (
        <button
            ref={setRefs}
            type="button"
            style={style}
            onClick={() => onActivate(tab.id)}
            {...attributes}
            {...listeners}
            className={[
                "group relative flex-1 min-w-[120px] h-7 rounded-full",
                "flex items-center px-7 text-xs",
                isActive
                    ? "glass bg-foreground/10 text-foreground"
                    : "text-foreground/60 hover:bg-foreground/10",
            ].join(" ")}
        >
            <TabTitle
                cwd={cwd}
                title={tab.title}
                className="pointer-events-none flex-1 justify-center"
            />
            <span
                role="button"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                }}
                className={[
                    "absolute right-1.5 top-1/2 -translate-y-1/2",
                    "size-4 flex items-center justify-center rounded-full",
                    "opacity-0 group-hover:opacity-100",
                    "hover:bg-foreground/15",
                ].join(" ")}
            >
                <span aria-hidden className="icon-[lucide--x] size-3 text-foreground/80" />
            </span>
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
        <div
            data-tauri-drag-region
            className="flex h-11 min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
                autoScroll={{ threshold: { x: 0.2, y: 0 }, acceleration: 20 }}
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
