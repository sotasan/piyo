import { Channel } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { IProgressState } from "@xterm/addon-progress";
import { create } from "zustand";

import { ptyClose, ptySpawn } from "@/ipc/commands";
import { onPtyCwd, onPtyExit } from "@/ipc/events";
import { useWorkspacesStore } from "@/stores/workspaces";

/** Raw bytes forwarded from the PTY reader thread. */
export type PtyEvent = ArrayBuffer;

export type Tab = {
    id: number;
    title: string;
    workspaceId: number;
};

const tabChannels = new Map<number, Channel<ArrayBuffer>>();
const tabHandlers = new Map<number, (event: PtyEvent) => void>();

interface TabsStore {
    tabs: Tab[];
    activeId: number | null;
    cwds: Map<number, string>;
    dims: { cols: number; rows: number };
    progress: Map<number, IProgressState>;

    spawn: (cwd: string | null, workspaceId: number) => Promise<number>;
    spawnSibling: () => Promise<number>;
    close: (rid: number) => void;
    reorder: (oldIndex: number, newIndex: number) => void;
    activate: (rid: number) => void;
    selectPrev: () => void;
    selectNext: () => void;
    showAtIndex: (index: number) => void;
    setDims: (cols: number, rows: number) => void;
    subscribeToTab: (rid: number, handler: (event: PtyEvent) => void) => () => void;
    setProgress: (rid: number, state: IProgressState) => void;

    handleTitle: (rid: number, title: string) => void;
    handleCwd: (rid: number, cwd: string) => void;
    handleExit: (rid: number) => void;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
    tabs: [],
    activeId: null,
    cwds: new Map(),
    dims: { cols: 80, rows: 24 },
    progress: new Map(),

    spawn: async (cwd, workspaceId) => {
        const channel = new Channel<ArrayBuffer>();
        const { cols, rows } = get().dims;
        const { rid, shell } = await ptySpawn(channel, cols, rows, cwd);
        channel.onmessage = (event) => tabHandlers.get(rid)?.(event);
        tabChannels.set(rid, channel);
        set((s) => ({
            tabs: [...s.tabs, { id: rid, title: shell, workspaceId }],
            activeId: rid,
        }));
        return rid;
    },

    spawnSibling: async () => {
        const { activeId, cwds, tabs, spawn } = get();
        if (activeId === null) {
            throw new Error("spawnSibling called with no active tab");
        }
        const active = tabs.find((t) => t.id === activeId);
        if (!active) {
            throw new Error("spawnSibling: active tab missing from tabs");
        }
        return spawn(cwds.get(activeId) ?? null, active.workspaceId);
    },

    close: (rid) => {
        void ptyClose(rid);
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
        const activeWsId = useWorkspacesStore.getState().activeId;
        if (activeWsId === null) return;
        const { tabs, activeId } = get();
        const visible = tabs.filter((t) => t.workspaceId === activeWsId);
        if (visible.length < 2 || activeId === null) return;
        const idx = visible.findIndex((t) => t.id === activeId);
        if (idx < 0) return;
        set({ activeId: visible[(idx - 1 + visible.length) % visible.length].id });
    },

    selectNext: () => {
        const activeWsId = useWorkspacesStore.getState().activeId;
        if (activeWsId === null) return;
        const { tabs, activeId } = get();
        const visible = tabs.filter((t) => t.workspaceId === activeWsId);
        if (visible.length < 2 || activeId === null) return;
        const idx = visible.findIndex((t) => t.id === activeId);
        if (idx < 0) return;
        set({ activeId: visible[(idx + 1) % visible.length].id });
    },

    showAtIndex: (index) => {
        const activeWsId = useWorkspacesStore.getState().activeId;
        if (activeWsId === null) return;
        const { tabs } = get();
        const visible = tabs.filter((t) => t.workspaceId === activeWsId);
        const t = visible[Math.min(index, visible.length - 1)];
        if (t) set({ activeId: t.id });
    },

    setDims: (cols, rows) => set({ dims: { cols, rows } }),

    subscribeToTab: (rid, handler) => {
        tabHandlers.set(rid, handler);
        return () => {
            if (tabHandlers.get(rid) === handler) tabHandlers.delete(rid);
        };
    },

    setProgress: (rid, state) =>
        set((s) => {
            const next = new Map(s.progress);
            if (state.state === 0) next.delete(rid);
            else next.set(rid, state);
            return { progress: next };
        }),

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
            const progress = new Map(s.progress);
            progress.delete(rid);
            const next = s.tabs.filter((t) => t.id !== rid);
            const nextActiveId = pickNextActive(rid, s.tabs, next, s.activeId);

            // If the active workspace just lost all its tabs, queue a replacement
            // spawn at the workspace's path so the terminal area is never empty.
            const closing = s.tabs.find((t) => t.id === rid);
            const wsState = useWorkspacesStore.getState();
            const activeWsId = wsState.activeId;
            if (
                closing &&
                activeWsId !== null &&
                closing.workspaceId === activeWsId &&
                !next.some((t) => t.workspaceId === activeWsId)
            ) {
                const ws = wsState.workspaces.find((w) => w.id === activeWsId);
                if (ws) {
                    queueMicrotask(() => {
                        void useTabsStore
                            .getState()
                            .spawn(ws.path, ws.id)
                            .then((newRid) =>
                                useWorkspacesStore.getState().setActiveTabFor(ws.id, newRid),
                            )
                            .catch((e) => console.error("auto-spawn on empty workspace failed", e));
                    });
                }
            }

            return {
                tabs: next,
                activeId: nextActiveId,
                cwds,
                progress,
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
    const closing = prevTabs.find((t) => t.id === closingRid);
    if (!closing) return nextTabs[nextTabs.length - 1]?.id ?? null;

    const sameWs = nextTabs.filter((t) => t.workspaceId === closing.workspaceId);
    if (sameWs.length === 0) return null;

    // Prefer the tab originally to the right of the closing tab within the same workspace.
    const prevSameWs = prevTabs.filter((t) => t.workspaceId === closing.workspaceId);
    const closingIdx = prevSameWs.findIndex((t) => t.id === closingRid);
    const rightNeighbour = prevSameWs[closingIdx + 1];
    if (rightNeighbour && sameWs.some((t) => t.id === rightNeighbour.id)) {
        return rightNeighbour.id;
    }
    // Otherwise, fall back to the rightmost remaining tab in the workspace.
    return sameWs[sameWs.length - 1].id;
}

export async function subscribeTabs(): Promise<UnlistenFn> {
    const store = useTabsStore.getState();
    const unlistens = await Promise.all([
        onPtyCwd(({ rid, cwd }) => store.handleCwd(rid, cwd)),
        onPtyExit(({ rid }) => store.handleExit(rid)),
    ]);
    return () => unlistens.forEach((u) => u());
}
