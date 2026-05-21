import { beforeEach, describe, expect, test } from "bun:test";

import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";

type SpawnCall = { cwd: string | null; workspaceId: number; resolvedRid: number };

function stubTabsSpawn() {
    const calls: SpawnCall[] = [];
    let nextRid = 100;
    const original = useTabsStore.getState().spawn;
    useTabsStore.setState({
        spawn: async (cwd, workspaceId) => {
            const rid = nextRid++;
            calls.push({ cwd, workspaceId, resolvedRid: rid });
            useTabsStore.setState((s) => ({
                tabs: [...s.tabs, { id: rid, title: "stub", workspaceId }],
                activeId: rid,
            }));
            return rid;
        },
    });
    return {
        calls,
        restore: () => useTabsStore.setState({ spawn: original }),
    };
}

beforeEach(() => {
    // Reset both stores to a clean slate.
    useTabsStore.setState({
        tabs: [],
        activeId: null,
        cwds: new Map(),
    });
    useWorkspacesStore.setState(useWorkspacesStore.getInitialState());
});

describe("useWorkspacesStore.bootstrapHome", () => {
    test("creates the home workspace and spawns an initial tab at the home path", async () => {
        const { calls, restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const state = useWorkspacesStore.getState();
            expect(state.workspaces).toHaveLength(1);
            expect(state.workspaces[0]).toMatchObject({
                path: "/Users/test",
                isHome: true,
            });
            expect(state.activeId).toBe(state.workspaces[0].id);
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                cwd: "/Users/test",
                workspaceId: state.workspaces[0].id,
            });
            expect(state.activeTabByWorkspace.get(state.workspaces[0].id)).toBe(
                calls[0].resolvedRid,
            );
        } finally {
            restore();
        }
    });

    test("is idempotent — calling again does not create a second home", async () => {
        const { restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
        } finally {
            restore();
        }
    });
});

describe("useWorkspacesStore.add", () => {
    test("appends a user workspace, activates it, and spawns at its path", async () => {
        const { calls, restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const newId = await useWorkspacesStore.getState().add("/projects/foo");
            const state = useWorkspacesStore.getState();
            expect(state.workspaces).toHaveLength(2);
            expect(state.workspaces[1]).toMatchObject({
                id: newId,
                path: "/projects/foo",
                isHome: false,
            });
            expect(state.activeId).toBe(newId);
            expect(calls).toHaveLength(2);
            expect(calls[1]).toMatchObject({ cwd: "/projects/foo", workspaceId: newId });
        } finally {
            restore();
        }
    });
});

describe("useWorkspacesStore.activate", () => {
    test("restores the previously active tab for the workspace", async () => {
        const { calls, restore } = stubTabsSpawn();
        try {
            const wsStore = useWorkspacesStore.getState();
            await wsStore.bootstrapHome("/Users/test");
            const homeId = useWorkspacesStore.getState().workspaces[0].id;
            const homeTabRid = calls[0].resolvedRid;

            const otherId = await wsStore.add("/projects/foo");
            // After add, the other workspace is active. Switch back to home.
            useWorkspacesStore.getState().activate(homeId);

            expect(useWorkspacesStore.getState().activeId).toBe(homeId);
            expect(useTabsStore.getState().activeId).toBe(homeTabRid);
            // Activating an existing workspace must NOT spawn a new tab.
            expect(calls).toHaveLength(2);
            // Sanity: otherId still exists and has its own active tab tracked.
            const otherTabRid = useWorkspacesStore.getState().activeTabByWorkspace.get(otherId);
            expect(typeof otherTabRid).toBe("number");
        } finally {
            restore();
        }
    });

    test("spawns a fresh tab when activating an empty workspace", async () => {
        const { calls, restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const otherId = await useWorkspacesStore.getState().add("/projects/foo");

            // Simulate every tab in the workspace being gone.
            useTabsStore.setState((s) => ({
                tabs: s.tabs.filter((t) => t.workspaceId !== otherId),
            }));
            useWorkspacesStore.getState().activeTabByWorkspace.delete(otherId);

            const before = calls.length;
            useWorkspacesStore.getState().activate(otherId);
            // activate is sync from the caller's perspective; the spawn it kicks off is async.
            await new Promise((r) => setTimeout(r, 0));

            expect(calls.length).toBe(before + 1);
            expect(calls.at(-1)).toMatchObject({ cwd: "/projects/foo", workspaceId: otherId });
        } finally {
            restore();
        }
    });
});

describe("useWorkspacesStore.activateAtIndex / activateHome", () => {
    test("activateAtIndex indexes user workspaces (home excluded)", async () => {
        const { restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const a = await useWorkspacesStore.getState().add("/a");
            const b = await useWorkspacesStore.getState().add("/b");

            useWorkspacesStore.getState().activateAtIndex(0);
            expect(useWorkspacesStore.getState().activeId).toBe(a);
            useWorkspacesStore.getState().activateAtIndex(1);
            expect(useWorkspacesStore.getState().activeId).toBe(b);
            // Out-of-range is a no-op.
            useWorkspacesStore.getState().activateAtIndex(9);
            expect(useWorkspacesStore.getState().activeId).toBe(b);
        } finally {
            restore();
        }
    });

    test("activateHome activates the home workspace", async () => {
        const { restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const homeId = useWorkspacesStore.getState().workspaces[0].id;
            await useWorkspacesStore.getState().add("/a");
            useWorkspacesStore.getState().activateHome();
            expect(useWorkspacesStore.getState().activeId).toBe(homeId);
        } finally {
            restore();
        }
    });
});

describe("useWorkspacesStore.reorder", () => {
    test("reorders only user workspaces; home stays at index 0", async () => {
        const { restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const a = await useWorkspacesStore.getState().add("/a");
            const b = await useWorkspacesStore.getState().add("/b");
            const c = await useWorkspacesStore.getState().add("/c");
            // user-index order is [a, b, c]; move c to the front -> [c, a, b]
            useWorkspacesStore.getState().reorder(2, 0);
            const state = useWorkspacesStore.getState();
            expect(state.workspaces[0].isHome).toBe(true);
            expect(state.workspaces.slice(1).map((w) => w.id)).toEqual([c, a, b]);
        } finally {
            restore();
        }
    });
});

describe("useWorkspacesStore.remove", () => {
    test("closes the workspace's tabs and activates the neighbour", async () => {
        const closedRids: number[] = [];
        const origClose = useTabsStore.getState().close;
        useTabsStore.setState({
            close: (rid: number) => {
                closedRids.push(rid);
                // Simulate handleExit synchronously: drop the tab.
                useTabsStore.setState((s) => ({ tabs: s.tabs.filter((t) => t.id !== rid) }));
            },
        });
        const { restore: restoreSpawn } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const a = await useWorkspacesStore.getState().add("/a");
            const b = await useWorkspacesStore.getState().add("/b");
            // b is currently active; remove b. Expect a (its left neighbour) to become active.
            const bTabRid = useWorkspacesStore.getState().activeTabByWorkspace.get(b)!;
            useWorkspacesStore.getState().remove(b);

            expect(closedRids).toContain(bTabRid);
            const state = useWorkspacesStore.getState();
            expect(state.workspaces.map((w) => w.id)).toEqual([0, a]);
            expect(state.activeId).toBe(a);
            expect(state.activeTabByWorkspace.has(b)).toBe(false);
        } finally {
            useTabsStore.setState({ close: origClose });
            restoreSpawn();
        }
    });

    test("refuses to remove home", async () => {
        const { restore } = stubTabsSpawn();
        try {
            await useWorkspacesStore.getState().bootstrapHome("/Users/test");
            const homeId = useWorkspacesStore.getState().workspaces[0].id;
            useWorkspacesStore.getState().remove(homeId);
            expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
        } finally {
            restore();
        }
    });
});
