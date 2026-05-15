import { Channel } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { ptyClose, ptySpawn } from "@/ipc/commands";
import { onPtyCwd, onPtyExit, onPtyModes, onPtyTitle } from "@/ipc/events";
import { clearPtyModes, setPtyModes } from "@/lib/ptyModes";

/** Raw bytes from the pty frame channel. The first byte is the
 *  discriminator (see `wire::KIND_*`). */
export type PtyEvent = ArrayBuffer;

export type Tab = {
    id: number;
    title: string;
};

const tabChannels = new Map<number, Channel<ArrayBuffer>>();
const tabHandlers = new Map<number, (event: PtyEvent) => void>();

interface TabsStore {
    tabs: Tab[];
    activeId: number | null;
    cwds: Map<number, string>;
    dims: { cols: number; rows: number };

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

    handleTitle: (rid: number, title: string) => void;
    handleCwd: (rid: number, cwd: string) => void;
    handleExit: (rid: number) => void;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
    tabs: [],
    activeId: null,
    cwds: new Map(),
    dims: { cols: 80, rows: 24 },

    spawn: async (cwd) => {
        const channel = new Channel<ArrayBuffer>();
        const { cols, rows } = get().dims;
        const { rid, shell } = await ptySpawn(channel, cols, rows, cwd);
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
            clearPtyModes(rid);
            const cwds = new Map(s.cwds);
            cwds.delete(rid);
            const next = s.tabs.filter((t) => t.id !== rid);
            return { tabs: next, activeId: pickNextActive(rid, s.tabs, next, s.activeId), cwds };
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
    const store = useTabsStore.getState();
    const unlistens = await Promise.all([
        onPtyTitle(({ rid, title }) => store.handleTitle(rid, title)),
        onPtyCwd(({ rid, cwd }) => store.handleCwd(rid, cwd)),
        onPtyExit(({ rid }) => store.handleExit(rid)),
        onPtyModes(({ rid, mouseTracking, bracketedPaste, focusEvent }) =>
            setPtyModes(rid, { mouseTracking, bracketedPaste, focusEvent }),
        ),
    ]);
    return () => unlistens.forEach((u) => u());
}
