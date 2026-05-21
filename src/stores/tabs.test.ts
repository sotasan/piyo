import { describe, expect, test } from "bun:test";

import type { Tab } from "@/stores/tabs";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";

describe("Tab type", () => {
    test("includes workspaceId", () => {
        const t: Tab = { id: 1, title: "fish", workspaceId: 0 };
        expect(t.workspaceId).toBe(0);
    });
});

function resetStores() {
    useTabsStore.setState({
        tabs: [],
        activeId: null,
        cwds: new Map(),
        progress: new Map(),
    });
    useWorkspacesStore.setState(useWorkspacesStore.getInitialState());
}

describe("useTabsStore.handleExit (workspace-aware)", () => {
    test("picks the next tab in the same workspace, not across workspaces", () => {
        resetStores();
        // Seed three tabs across two workspaces: ws0=[1,2], ws1=[3]
        useTabsStore.setState({
            tabs: [
                { id: 1, title: "a", workspaceId: 0 },
                { id: 2, title: "b", workspaceId: 0 },
                { id: 3, title: "c", workspaceId: 1 },
            ],
            activeId: 1,
        });
        useTabsStore.getState().handleExit(1);
        // Active should fall through to tab 2 (next tab in ws0), not tab 3 (different workspace).
        expect(useTabsStore.getState().activeId).toBe(2);
    });

    test("falls back to previous tab in workspace if closed tab was last", () => {
        resetStores();
        useTabsStore.setState({
            tabs: [
                { id: 1, title: "a", workspaceId: 0 },
                { id: 2, title: "b", workspaceId: 0 },
            ],
            activeId: 2,
        });
        useTabsStore.getState().handleExit(2);
        expect(useTabsStore.getState().activeId).toBe(1);
    });

    test("auto-spawns a fresh tab when the active workspace lost its last tab", async () => {
        resetStores();
        // Build the active workspace ourselves so handleExit can find its path.
        useWorkspacesStore.setState({
            workspaces: [{ id: 7, path: "/p", isHome: false }],
            activeId: 7,
            activeTabByWorkspace: new Map(),
            nextId: 8,
        });
        useTabsStore.setState({
            tabs: [{ id: 50, title: "only", workspaceId: 7 }],
            activeId: 50,
        });

        // Stub spawn to record the auto-spawn invocation.
        const calls: { cwd: string | null; workspaceId: number }[] = [];
        const original = useTabsStore.getState().spawn;
        useTabsStore.setState({
            spawn: async (cwd, workspaceId) => {
                calls.push({ cwd, workspaceId });
                useTabsStore.setState((s) => ({
                    tabs: [...s.tabs, { id: 999, title: "stub", workspaceId }],
                    activeId: 999,
                }));
                return 999;
            },
        });

        try {
            useTabsStore.getState().handleExit(50);
            await new Promise((r) => setTimeout(r, 0));
            expect(calls).toEqual([{ cwd: "/p", workspaceId: 7 }]);
            expect(useTabsStore.getState().activeId).toBe(999);
        } finally {
            useTabsStore.setState({ spawn: original });
        }
    });

    test("non-active workspace losing its last tab does NOT auto-spawn", () => {
        resetStores();
        useWorkspacesStore.setState({
            workspaces: [
                { id: 0, path: "/h", isHome: true },
                { id: 1, path: "/p", isHome: false },
            ],
            activeId: 0,
            activeTabByWorkspace: new Map(),
            nextId: 2,
        });
        useTabsStore.setState({
            tabs: [
                { id: 10, title: "home", workspaceId: 0 },
                { id: 20, title: "p", workspaceId: 1 },
            ],
            activeId: 10,
        });

        const calls: unknown[] = [];
        const original = useTabsStore.getState().spawn;
        useTabsStore.setState({
            spawn: (async (cwd: string | null, workspaceId: number) => {
                calls.push({ cwd, workspaceId });
                return 0;
            }) as typeof original,
        });

        try {
            useTabsStore.getState().handleExit(20);
            // No auto-spawn for a non-active workspace.
            expect(calls).toEqual([]);
            // Active id is unchanged.
            expect(useTabsStore.getState().activeId).toBe(10);
        } finally {
            useTabsStore.setState({ spawn: original });
        }
    });
});
