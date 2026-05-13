import { FileTree } from "@pierre/trees";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { entryToTreePath, fsWatchStart, fsWatchStop, listDir, subscribeFsEvents, type FsEvent } from "@/lib/fsBridge";

function stripTrailingSlash(p: string): string {
    return p.endsWith("/") ? p.slice(0, -1) : p;
}

const FOLDER_ICON_URL = "icon://localhost/tmp?size=32";

const FOLDER_ICON_CSS = `
[data-item-type='folder'] [data-item-section='icon'] {
    width: auto;
    padding-inline-end: 6px;
    gap: 4px;
}
[data-item-type='folder'] [data-item-section='icon']::after {
    content: '';
    flex: 0 0 16px;
    width: 16px;
    height: 16px;
    background-image: url('${FOLDER_ICON_URL}');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
}
`;

export type PtyEvent = { kind: "data"; data: number[] } | { kind: "exit" };

export type Tab = {
    id: number;
    title: string;
};

export type TabTree = {
    model: FileTree;
    root: string;
    hydrated: Set<string>;
    knownDirs: Set<string>;
    unsubscribe: () => void;
};

const tabChannels = new Map<number, Channel<PtyEvent>>();
const tabHandlers = new Map<number, (event: PtyEvent) => void>();

interface TabsStore {
    tabs: Tab[];
    activeId: number | null;
    cwds: Map<number, string>;
    dims: { cols: number; rows: number };
    trees: Map<number, TabTree>;

    spawn: (cwd: string | null) => Promise<number>;
    spawnSibling: () => Promise<number>;
    close: (rid: number) => void;
    reorder: (oldIndex: number, newIndex: number) => void;
    activate: (rid: number) => void;
    selectPrev: () => void;
    selectNext: () => void;
    showAtIndex: (index: number) => void;
    setDims: (cols: number, rows: number) => void;
    subscribeToTab: (rid: number, handler: (event: PtyEvent) => void) => () => void;
    getOrCreateTree: (rid: number) => TabTree | null;
    expandDirectory: (rid: number, path: string) => Promise<void>;

    handleTitle: (rid: number, title: string) => void;
    handleCwd: (rid: number, cwd: string) => void;
    handleExit: (rid: number) => void;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
    tabs: [],
    activeId: null,
    cwds: new Map(),
    dims: { cols: 80, rows: 24 },
    trees: new Map(),

    spawn: async (cwd) => {
        const channel = new Channel<PtyEvent>();
        const { cols, rows } = get().dims;
        const { rid, shell } = await invoke<{ rid: number; shell: string }>("pty_spawn", {
            events: channel,
            cols,
            rows,
            cwd,
        });
        channel.onmessage = (event) => tabHandlers.get(rid)?.(event);
        tabChannels.set(rid, channel);
        set((s) => ({
            tabs: [...s.tabs, { id: rid, title: shell }],
            activeId: rid,
        }));
        return rid;
    },

    spawnSibling: () => {
        const { activeId, cwds, spawn } = get();
        return spawn(activeId !== null ? (cwds.get(activeId) ?? null) : null);
    },

    close: (rid) => {
        invoke("pty_close", { rid }).catch((e) => console.error("pty_close failed", e));
    },

    reorder: (oldIndex, newIndex) =>
        set((s) => {
            const tabs = [...s.tabs];
            const [moved] = tabs.splice(oldIndex, 1);
            tabs.splice(newIndex, 0, moved);
            return { tabs };
        }),

    activate: (rid) => set({ activeId: rid }),

    selectPrev: () => {
        const { tabs, activeId } = get();
        if (tabs.length < 2 || activeId === null) return;
        const idx = tabs.findIndex((t) => t.id === activeId);
        set({ activeId: tabs[(idx - 1 + tabs.length) % tabs.length].id });
    },

    selectNext: () => {
        const { tabs, activeId } = get();
        if (tabs.length < 2 || activeId === null) return;
        const idx = tabs.findIndex((t) => t.id === activeId);
        set({ activeId: tabs[(idx + 1) % tabs.length].id });
    },

    showAtIndex: (index) => {
        const { tabs } = get();
        const t = tabs[Math.min(index, tabs.length - 1)];
        if (t) set({ activeId: t.id });
    },

    setDims: (cols, rows) => set({ dims: { cols, rows } }),

    subscribeToTab: (rid, handler) => {
        tabHandlers.set(rid, handler);
        return () => {
            if (tabHandlers.get(rid) === handler) tabHandlers.delete(rid);
        };
    },

    getOrCreateTree: (rid) => {
        const state = get();
        const existing = state.trees.get(rid);
        if (existing) return existing;
        const root = state.cwds.get(rid);
        if (!root) return null;

        const model = new FileTree({
            paths: [],
            initialExpansion: "closed",
            unsafeCSS: FOLDER_ICON_CSS,
        });
        const entry: TabTree = {
            model,
            root,
            hydrated: new Set(),
            knownDirs: new Set(),
            unsubscribe: () => {},
        };

        const checkExpansion = () => {
            for (const dirPath of entry.knownDirs) {
                if (entry.hydrated.has(dirPath)) continue;
                const item = entry.model.getItem(dirPath);
                if (item && item.isDirectory() && (item as import("@pierre/trees").FileTreeDirectoryHandle).isExpanded()) {
                    void get().expandDirectory(rid, dirPath);
                }
            }
        };

        entry.unsubscribe = entry.model.subscribe(checkExpansion);

        set((s) => {
            const trees = new Map(s.trees);
            trees.set(rid, entry);
            return { trees };
        });

        // fs watcher temporarily disabled — was freezing the app when cwd is in a
        // high-churn directory (e.g., project root with bun tauri dev running).
        // fsWatchStart(rid, root).catch((err) => console.error("fs_watch_start failed", err));
        void fsWatchStart;

        listDir(root)
            .then((entries) => {
                const ops = entries.map((e) => ({
                    type: "add" as const,
                    path: entryToTreePath("", e),
                }));
                if (ops.length > 0) model.batch(ops);
                for (const e of entries) {
                    if (e.isDir) entry.knownDirs.add(entryToTreePath("", e));
                }
                entry.hydrated.add("");
            })
            .catch((err) => console.error("initial list_dir failed", err));

        return entry;
    },

    expandDirectory: async (rid, path) => {
        const tree = get().trees.get(rid);
        if (!tree) return;
        if (tree.hydrated.has(path)) return;
        tree.hydrated.add(path);

        const abs = path === "" ? tree.root : `${tree.root}/${stripTrailingSlash(path)}`;
        try {
            const entries = await listDir(abs);
            const ops = entries.map((e) => ({
                type: "add" as const,
                path: entryToTreePath(path, e),
            }));
            if (ops.length > 0) tree.model.batch(ops);
            for (const e of entries) {
                if (e.isDir) tree.knownDirs.add(entryToTreePath(path, e));
            }
        } catch (err) {
            console.error("expandDirectory failed", path, err);
            // Drop from hydrated so a later attempt can retry.
            tree.hydrated.delete(path);
        }
    },

    handleTitle: (rid, title) =>
        set((s) => ({
            tabs: s.tabs.map((t) => (t.id === rid ? { ...t, title } : t)),
        })),

    handleCwd: (rid, cwd) =>
        set((s) => {
            const cwds = new Map(s.cwds);
            cwds.set(rid, cwd);
            const trees = new Map(s.trees);
            const tree = trees.get(rid);
            if (tree && tree.root !== cwd) {
                tree.unsubscribe();
                tree.model.cleanUp();
                trees.delete(rid);
                fsWatchStop(rid).catch((err) => console.error("fs_watch_stop failed", err));
            }
            return { cwds, trees };
        }),

    handleExit: (rid) =>
        set((s) => {
            tabChannels.delete(rid);
            tabHandlers.delete(rid);
            const cwds = new Map(s.cwds);
            cwds.delete(rid);
            const trees = new Map(s.trees);
            const tree = trees.get(rid);
            if (tree) {
                tree.unsubscribe();
                tree.model.cleanUp();
                trees.delete(rid);
                fsWatchStop(rid).catch((err) => console.error("fs_watch_stop failed", err));
            }
            const next = s.tabs.filter((t) => t.id !== rid);
            return {
                tabs: next,
                activeId: pickNextActive(rid, s.tabs, next, s.activeId),
                cwds,
                trees,
            };
        }),
}));

function applyFsEvent(tree: TabTree, event: FsEvent): void {
    const treePath = event.isDir ? `${event.path}/` : event.path;
    const parent = parentDir(event.path);
    if (!tree.hydrated.has(parent)) return;

    switch (event.kind) {
        case "create":
            tree.model.add(treePath);
            if (event.isDir) tree.knownDirs.add(treePath);
            break;
        case "remove":
            tree.model.remove(treePath);
            if (event.isDir) {
                tree.knownDirs.delete(treePath);
                tree.hydrated.delete(treePath);
                // Drop descendants too — they're gone with their parent.
                const prefix = treePath;
                for (const d of tree.knownDirs) {
                    if (d.startsWith(prefix)) tree.knownDirs.delete(d);
                }
                for (const h of tree.hydrated) {
                    if (h.startsWith(prefix)) tree.hydrated.delete(h);
                }
            }
            break;
        case "rename": {
            if (event.fromPath === undefined) return;
            const fromTreePath = event.isDir ? `${event.fromPath}/` : event.fromPath;
            tree.model.move(fromTreePath, treePath);
            if (event.isDir) {
                tree.knownDirs.delete(fromTreePath);
                tree.knownDirs.add(treePath);
            }
            break;
        }
    }
}

function parentDir(relPath: string): string {
    const trimmed = relPath.endsWith("/") ? relPath.slice(0, -1) : relPath;
    const idx = trimmed.lastIndexOf("/");
    return idx === -1 ? "" : `${trimmed.slice(0, idx)}/`;
}

function pickNextActive(
    closingRid: number,
    prevTabs: Tab[],
    nextTabs: Tab[],
    currentActiveId: number | null,
): number | null {
    if (currentActiveId !== closingRid) return currentActiveId;
    const closingIdx = prevTabs.findIndex((t) => t.id === closingRid);
    return prevTabs[closingIdx + 1]?.id ?? nextTabs[nextTabs.length - 1]?.id ?? null;
}

export async function subscribeTabs(): Promise<UnlistenFn> {
    const unlistens = await Promise.all([
        listen<{ rid: number; title: string }>("pty:title", (e) =>
            useTabsStore.getState().handleTitle(e.payload.rid, e.payload.title),
        ),
        listen<{ rid: number; cwd: string }>("pty:cwd", (e) =>
            useTabsStore.getState().handleCwd(e.payload.rid, e.payload.cwd),
        ),
        listen<{ rid: number }>("pty:exit", (e) =>
            useTabsStore.getState().handleExit(e.payload.rid),
        ),
        subscribeFsEvents((event) => {
            const tree = useTabsStore.getState().trees.get(event.rid);
            if (tree) applyFsEvent(tree, event);
        }),
    ]);
    return () => unlistens.forEach((u) => u());
}
