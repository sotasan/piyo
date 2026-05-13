import { FileTree } from "@pierre/trees/react";
import { useEffect } from "react";

import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";

function FileTreePanel() {
    const activeId = useTabsStore((s) => s.activeId);
    const cwd = useTabsStore((s) =>
        s.activeId !== null ? (s.cwds.get(s.activeId) ?? null) : null,
    );
    const tree = useTabsStore((s) =>
        s.activeId !== null ? (s.trees.get(s.activeId) ?? null) : null,
    );
    const treeStyles = useThemeStore((s) => s.theme?.treeStyles);

    useEffect(() => {
        if (activeId !== null && cwd) {
            useTabsStore.getState().getOrCreateTree(activeId);
        }
    }, [activeId, cwd]);

    if (activeId === null || !tree) return null;

    return (
        <FileTree
            key={activeId}
            model={tree.model}
            className="h-full"
            style={treeStyles}
        />
    );
}

export default FileTreePanel;
