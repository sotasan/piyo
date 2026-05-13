import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect } from "react";

import { entryToTreePath, listDir } from "@/lib/fsBridge";
import { useTabsStore } from "@/stores/tabs";

function FileTreePanel() {
    const activeId = useTabsStore((s) => s.activeId);
    const cwd = useTabsStore((s) => (s.activeId !== null ? (s.cwds.get(s.activeId) ?? "") : ""));

    const { model } = useFileTree({ paths: [], initialExpansion: "closed" });

    useEffect(() => {
        if (!cwd) return;
        let cancelled = false;
        listDir(cwd)
            .then((entries) => {
                if (cancelled) return;
                model.resetPaths(entries.map((e) => entryToTreePath("", e)));
            })
            .catch((err) => console.error("list_dir failed", err));
        return () => {
            cancelled = true;
        };
    }, [cwd, model]);

    if (activeId === null) return null;
    return <FileTree model={model} className="h-full" />;
}

export default FileTreePanel;
