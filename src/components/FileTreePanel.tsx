import { FileTree } from "@pierre/trees/react";

import { useTabsStore } from "@/stores/tabs";

function FileTreePanel() {
    const activeId = useTabsStore((s) => s.activeId);
    const tree = useTabsStore((s) => (s.activeId !== null ? s.getOrCreateTree(s.activeId) : null));

    if (activeId === null || !tree) return null;

    return <FileTree key={activeId} model={tree.model} className="h-full" />;
}

export default FileTreePanel;
