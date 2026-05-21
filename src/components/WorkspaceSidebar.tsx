import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import AddWorkspaceButton from "@/components/AddWorkspaceButton";
import WorkspaceIcon from "@/components/WorkspaceIcon";
import { useWorkspacesStore, type Workspace } from "@/stores/workspaces";

function SortableUserWorkspace({
    workspace,
    isActive,
}: {
    workspace: Workspace;
    isActive: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: workspace.id,
    });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} role={undefined}>
            <WorkspaceIcon
                workspace={workspace}
                isActive={isActive}
                onActivate={(id) => useWorkspacesStore.getState().activate(id)}
            />
        </div>
    );
}

function WorkspaceSidebar() {
    const workspaces = useWorkspacesStore((s) => s.workspaces);
    const activeId = useWorkspacesStore((s) => s.activeId);
    const reorder = useWorkspacesStore((s) => s.reorder);

    const home = workspaces.find((w) => w.isHome);
    const userWorkspaces = workspaces.filter((w) => !w.isHome);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = userWorkspaces.findIndex((w) => w.id === active.id);
        const newIndex = userWorkspaces.findIndex((w) => w.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        reorder(oldIndex, newIndex);
    };

    return (
        <aside className="flex h-full w-13 shrink-0 flex-col items-center gap-1 bg-transparent pt-11 pb-2">
            {home && (
                <WorkspaceIcon
                    workspace={home}
                    isActive={home.id === activeId}
                    onActivate={(id) => useWorkspacesStore.getState().activate(id)}
                />
            )}
            <div className="my-1 h-px w-6 bg-foreground/15" />
            <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col items-center gap-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVerticalAxis]}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={userWorkspaces.map((w) => w.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {userWorkspaces.map((w) => (
                            <SortableUserWorkspace
                                key={w.id}
                                workspace={w}
                                isActive={w.id === activeId}
                            />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>
            <AddWorkspaceButton />
        </aside>
    );
}

export default WorkspaceSidebar;
