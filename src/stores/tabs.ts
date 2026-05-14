import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

/** RGB color tuple, 0–255. */
export type Rgb = [number, number, number];

/** A single cell in a [`GhosttyFrame`]. */
export type GhosttyCell = {
    text: string;
    fg: Rgb | null;
    bg: Rgb | null;
    /** Bit flags: 1=bold, 2=italic, 4=underline, 8=inverse, 16=faint,
     *  32=strikethrough, 64=blink, 128=invisible. */
    flags: number;
};

export type GhosttyRow = {
    y: number;
    cells: GhosttyCell[];
};

export type GhosttyCursor = {
    x: number;
    y: number;
    visible: boolean;
    blinking: boolean;
    /** 0=block, 1=block_hollow, 2=underline, 3=bar. */
    style: 0 | 1 | 2 | 3;
};

/** Kitty graphics image pixel data, base64-encoded 8-bit RGBA. Shipped on
 *  first sighting per session; the frontend caches by `id` afterwards. */
export type GhosttyImage = {
    id: number;
    width: number;
    height: number;
    rgba: string;
};

/** A kitty graphics placement visible in the current viewport. Refers to an
 *  image by id; the renderer pulls pixel data from its cache. */
export type GhosttyPlacement = {
    imageId: number;
    placementId: number;
    /** Viewport-relative grid column. May be negative for partial visibility. */
    viewportCol: number;
    /** Viewport-relative grid row. May be negative for partial visibility. */
    viewportRow: number;
    pixelWidth: number;
    pixelHeight: number;
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
    z: number;
};

/** Snapshot from libghostty-vt of the dirty parts of the terminal grid. */
export type GhosttyFrame = {
    cols: number;
    rows: number;
    background: Rgb;
    foreground: Rgb;
    /** If true, the renderer should clear and reapply every row in `dirty`. */
    full: boolean;
    cursor: GhosttyCursor | null;
    dirty: GhosttyRow[];
    images: GhosttyImage[];
    placements: GhosttyPlacement[];
};

export type PtyEvent = { kind: "frame"; data: GhosttyFrame } | { kind: "exit" };

export type Tab = {
    id: number;
    title: string;
};

const tabChannels = new Map<number, Channel<PtyEvent>>();
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
