import { create } from "zustand";

import { useTabsStore } from "@/stores/tabs";

export type Workspace = {
    id: number;
    path: string;
    isHome: boolean;
};

interface WorkspacesStore {
    workspaces: Workspace[];
    activeId: number | null;
    activeTabByWorkspace: Map<number, number>;
    nextId: number;

    bootstrapHome: (homePath: string) => Promise<void>;
    add: (path: string) => Promise<number>;
    remove: (id: number) => void;
    activate: (id: number) => void;
    activateHome: () => void;
    activateAtIndex: (n: number) => void;
    reorder: (oldIndex: number, newIndex: number) => void;
    setActiveTabFor: (wsId: number, tabId: number) => void;
}

export const useWorkspacesStore = create<WorkspacesStore>((set, get) => ({
    workspaces: [],
    activeId: null,
    activeTabByWorkspace: new Map(),
    nextId: 0,

    bootstrapHome: async (homePath) => {
        if (get().workspaces.some((w) => w.isHome)) return;
        const id = get().nextId;
        const home: Workspace = { id, path: homePath, isHome: true };
        set((s) => ({
            workspaces: [home, ...s.workspaces],
            activeId: id,
            nextId: s.nextId + 1,
        }));
        const rid = await useTabsStore.getState().spawn(homePath, id);
        get().setActiveTabFor(id, rid);
    },

    add: async (path) => {
        const id = get().nextId;
        const ws: Workspace = { id, path, isHome: false };
        set((s) => ({
            workspaces: [...s.workspaces, ws],
            activeId: id,
            nextId: s.nextId + 1,
        }));
        const rid = await useTabsStore.getState().spawn(path, id);
        get().setActiveTabFor(id, rid);
        return id;
    },

    remove: (id) => {
        const { workspaces, activeId } = get();
        const ws = workspaces.find((w) => w.id === id);
        if (!ws || ws.isHome) return;

        // Close every tab that belongs to this workspace.
        const tabsInWs = useTabsStore.getState().tabs.filter((t) => t.workspaceId === id);
        for (const t of tabsInWs) useTabsStore.getState().close(t.id);

        const nextWorkspaces = workspaces.filter((w) => w.id !== id);
        const nextActiveTabByWorkspace = new Map(get().activeTabByWorkspace);
        nextActiveTabByWorkspace.delete(id);

        let nextActiveId = activeId;
        if (activeId === id) {
            const removedIndex = workspaces.findIndex((w) => w.id === id);
            const left = workspaces[removedIndex - 1];
            nextActiveId = left?.id ?? nextWorkspaces[0]?.id ?? null;
        }

        set({
            workspaces: nextWorkspaces,
            activeId: nextActiveId,
            activeTabByWorkspace: nextActiveTabByWorkspace,
        });

        if (nextActiveId !== null && nextActiveId !== activeId) {
            // Re-enter the activate flow so the new active workspace gets a tab if it has none.
            get().activate(nextActiveId);
        }
    },

    activate: (id) => {
        const ws = get().workspaces.find((w) => w.id === id);
        if (!ws) return;
        set({ activeId: id });

        const remembered = get().activeTabByWorkspace.get(id);
        const stillExists =
            remembered !== undefined &&
            useTabsStore.getState().tabs.some((t) => t.id === remembered);

        if (remembered !== undefined && stillExists) {
            useTabsStore.setState({ activeId: remembered });
            return;
        }

        // No remembered tab — try to pick any existing tab in the workspace,
        // otherwise spawn a fresh initial tab at the workspace path.
        const existing = useTabsStore.getState().tabs.find((t) => t.workspaceId === id);
        if (existing) {
            useTabsStore.setState({ activeId: existing.id });
            get().setActiveTabFor(id, existing.id);
            return;
        }

        void useTabsStore
            .getState()
            .spawn(ws.path, id)
            .then((rid) => get().setActiveTabFor(id, rid))
            .catch((e) => console.error("workspace activate spawn failed", e));
    },

    activateHome: () => {
        const home = get().workspaces.find((w) => w.isHome);
        if (home) get().activate(home.id);
    },

    activateAtIndex: (n) => {
        const userWorkspaces = get().workspaces.filter((w) => !w.isHome);
        const target = userWorkspaces[n];
        if (target) get().activate(target.id);
    },

    reorder: (oldIndex, newIndex) =>
        set((s) => {
            const userWorkspaces = s.workspaces.filter((w) => !w.isHome);
            if (
                oldIndex < 0 ||
                newIndex < 0 ||
                oldIndex >= userWorkspaces.length ||
                newIndex >= userWorkspaces.length
            ) {
                return s;
            }
            const moved = userWorkspaces.splice(oldIndex, 1)[0];
            userWorkspaces.splice(newIndex, 0, moved);
            const home = s.workspaces.find((w) => w.isHome);
            return { workspaces: home ? [home, ...userWorkspaces] : userWorkspaces };
        }),

    setActiveTabFor: (wsId, tabId) =>
        set((s) => {
            const next = new Map(s.activeTabByWorkspace);
            next.set(wsId, tabId);
            return { activeTabByWorkspace: next };
        }),
}));
