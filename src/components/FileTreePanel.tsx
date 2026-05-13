import { FileTree } from "@pierre/trees/react";
import { useEffect } from "react";

import { useTabsStore } from "@/stores/tabs";

function FileTreePanel() {
    const activeId = useTabsStore((s) => s.activeId);
    const tree = useTabsStore((s) =>
        s.activeId !== null ? (s.trees.get(s.activeId) ?? null) : null,
    );

    useEffect(() => {
        if (activeId !== null) {
            useTabsStore.getState().getOrCreateTree(activeId);
        }
    }, [activeId]);

    if (activeId === null || !tree) return null;

    return <FileTree key={activeId} model={tree.model} className="h-full" />;
}

export default FileTreePanel;
