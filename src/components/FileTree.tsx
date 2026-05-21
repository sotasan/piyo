import { useWorkspacesStore } from "@/stores/workspaces";

function FileTree() {
    // Read the active workspace's path now so the future file-tree
    // implementation has it on hand; the body is intentionally empty
    // (parity with the previous Sidebar) for v1.
    void useWorkspacesStore((s) =>
        s.activeId === null ? undefined : s.workspaces.find((w) => w.id === s.activeId)?.path,
    );
    return <aside className="flex h-full flex-col items-center gap-2 bg-transparent py-2" />;
}

export default FileTree;
