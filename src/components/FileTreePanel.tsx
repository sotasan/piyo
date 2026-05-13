import { FileTree } from "@pierre/trees/react";
import { useEffect } from "react";

import { useTabsStore, type TabTree } from "@/stores/tabs";
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

    useEffect(() => {
        if (!tree) return;
        return installPerFolderIcons(tree);
    }, [tree]);

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

function installPerFolderIcons(tree: TabTree): () => void {
    let styleEl: HTMLStyleElement | null = null;
    let lastSize = -1;
    let raf = 0;

    const update = () => {
        if (tree.knownDirs.size === lastSize) return;
        lastSize = tree.knownDirs.size;

        if (!styleEl) {
            const host = tree.model.getFileTreeContainer();
            const root = host?.shadowRoot;
            if (!root) return;
            styleEl = document.createElement("style");
            root.appendChild(styleEl);
        }

        const rules: string[] = [];
        for (const dirPath of tree.knownDirs) {
            const absPath =
                dirPath === ""
                    ? tree.root
                    : `${tree.root}/${dirPath.endsWith("/") ? dirPath.slice(0, -1) : dirPath}`;
            const sel = `[data-item-path=${JSON.stringify(dirPath)}] [data-item-section='icon']::after`;
            const url = JSON.stringify(`icon://localhost${absPath}?size=32`);
            rules.push(`${sel} { background-image: url(${url}); }`);
        }
        styleEl.textContent = rules.join("\n");
    };

    const schedule = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            update();
        });
    };

    schedule();
    const unsub = tree.model.subscribe(schedule);

    return () => {
        if (raf) cancelAnimationFrame(raf);
        unsub();
        styleEl?.remove();
    };
}

export default FileTreePanel;
