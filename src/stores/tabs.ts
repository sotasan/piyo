import { FileTree } from "@pierre/trees";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { entryToTreePath, listDir } from "@/lib/fsBridge";

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

        const model = new FileTree({ paths: [], initialExpansion: "closed" });
        const entry: TabTree = {
            model,
            root,
            hydrated: new Set(),
            knownDirs: new Set(),
            unsubscribe: () => {},
        };

        // Synchronously install in the map so concurrent calls find it.
        set((s) => {
            const trees = new Map(s.trees);
            trees.set(rid, entry);
            return { trees };
        });

        // Fire-and-forget initial root load.
        listDir(root)
            .then((entries) => {
                const ops = entries.map((e) => ({
                    type: "add" as const,
                    path: entryToTreePath("", e),
                }));
                model.batch(ops);
                // Track directories created at the root level.
                for (const e of entries) {
                    if (e.isDir) entry.knownDirs.add(entryToTreePath("", e));
                }
                // The root itself is hydrated (we just loaded its children).
                entry.hydrated.add("");
            })
            .catch((err) => console.error("initial list_dir failed", err));

        return entry;
    },

    handleTitle: (rid, title) =>
        set((s) => ({
            tabs: s.tabs.map((t) => (t.id === rid ? { ...t, title } : t)),
        })),

    handleCwd: (rid, cwd) =>
        set((s) => {
            const cwds = new Map(s.cwds);
            cwds.set(rid, cwd);
            return { cwds };
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
    ]);
    return () => unlistens.forEach((u) => u());
}
