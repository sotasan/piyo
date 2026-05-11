import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import type { PtyEvent } from "@/components/Terminal";

export type Tab = {
    id: number;
    title: string;
    channel: Channel<PtyEvent>;
};

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
        const channel = new Channel<PtyEvent>();
        const { cols, rows } = get().dims;
        const rid = await invoke<number>("pty_spawn", { events: channel, cols, rows, cwd });
        set((s) => ({
            tabs: [...s.tabs, { id: rid, title: "", channel }],
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
            const cwds = new Map(s.cwds);
            cwds.delete(rid);
            const oldIdx = s.tabs.findIndex((t) => t.id === rid);
            const next = s.tabs.filter((t) => t.id !== rid);
            const activeId =
                s.activeId !== rid
                    ? s.activeId
                    : (s.tabs[oldIdx + 1]?.id ?? next[next.length - 1]?.id ?? null);
            return { tabs: next, activeId, cwds };
        }),
}));

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
