import { create } from "zustand";

export type Tab = { id: number; ptyId: number | null };

export type Workspace = {
    id: number;
    tabs: Tab[];
    activeTabId: number;
};

let nextId = 0;
const newId = () => ++nextId;

const newWorkspace = (): Workspace => {
    const tab: Tab = { id: newId(), ptyId: null };
    return { id: newId(), tabs: [tab], activeTabId: tab.id };
};

type WorkspaceStore = {
    workspaces: Workspace[];
    activeId: number;
    titles: Record<number, string>;

    addWorkspace: () => void;
    closeWorkspace: (id: number) => void;
    setActiveId: (id: number) => void;
    setTabPty: (tabId: number, ptyId: number) => void;
    setTitle: (ptyId: number, title: string) => void;

    switchTo: (index: number) => void;
    next: () => void;
    prev: () => void;
};

const initial = newWorkspace();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
    workspaces: [initial],
    activeId: initial.id,
    titles: {},

    addWorkspace: () => {
        const ws = newWorkspace();
        set((s) => ({ workspaces: [...s.workspaces, ws], activeId: ws.id }));
    },

    closeWorkspace: (id) =>
        set((s) => {
            if (s.workspaces.length <= 1) return s;
            const idx = s.workspaces.findIndex((w) => w.id === id);
            if (idx < 0) return s;
            const next = s.workspaces.filter((w) => w.id !== id);
            const activeId = s.activeId === id ? next[Math.max(0, idx - 1)].id : s.activeId;
            return { workspaces: next, activeId };
        }),

    setActiveId: (id) => set({ activeId: id }),

    setTabPty: (tabId, ptyId) =>
        set((s) => ({
            workspaces: s.workspaces.map((w) => ({
                ...w,
                tabs: w.tabs.map((t) => (t.id === tabId ? { ...t, ptyId } : t)),
            })),
        })),

    setTitle: (ptyId, title) => set((s) => ({ titles: { ...s.titles, [ptyId]: title } })),

    switchTo: (index) => {
        const { workspaces } = get();
        if (workspaces[index]) set({ activeId: workspaces[index].id });
    },

    next: () => {
        const { workspaces, activeId } = get();
        const i = workspaces.findIndex((w) => w.id === activeId);
        if (i < 0) return;
        set({ activeId: workspaces[(i + 1) % workspaces.length].id });
    },

    prev: () => {
        const { workspaces, activeId } = get();
        const i = workspaces.findIndex((w) => w.id === activeId);
        if (i < 0) return;
        set({ activeId: workspaces[(i - 1 + workspaces.length) % workspaces.length].id });
    },
}));

export function useActiveTitle(): string {
    return useWorkspaceStore((s) => {
        const ws = s.workspaces.find((w) => w.id === s.activeId);
        const tab = ws?.tabs.find((t) => t.id === ws.activeTabId);
        return tab?.ptyId != null ? (s.titles[tab.ptyId] ?? "") : "";
    });
}
