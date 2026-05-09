import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelSize } from "react-resizable-panels";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import TabBar from "@/components/TabBar";
import Terminal, { type PtyEvent } from "@/components/Terminal";
import Titlebar from "@/components/Titlebar";
import { installMenu, type MenuState } from "@/menu";
import "@/App.css";

const TRAFFIC_LIGHTS_INSET_PX = 84;
const DEFAULT_SIDEBAR_PX = 200;
const SEPARATOR_PX = 4;
const TWEEN = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };
const MotionSeparator = motion.create(Separator);

type Tab = {
    id: number; // backend ResourceId
    title: string;
    channel: Channel<PtyEvent>;
};

function App() {
    const sidebarRef = usePanelRef();
    const [collapsed, setCollapsed] = useState(true);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeId, setActiveId] = useState<number | null>(null);
    const dimsRef = useRef({ cols: 80, rows: 24 });
    const stateRef = useRef<MenuState>({ tabs: [], activeId: null });
    useEffect(() => {
        stateRef.current = { tabs: tabs.map(({ id, title }) => ({ id, title })), activeId };
    });

    const refreshMenuRef = useRef<(() => Promise<void>) | null>(null);

    useEffect(() => {
        refreshMenuRef.current?.();
    }, [tabs, activeId]);
    const sizeMV = useMotionValue(0);
    const lastExpandedRef = useRef(DEFAULT_SIDEBAR_PX);
    const isAnimatingRef = useRef(false);

    // Spawn a new tab. Returns the new rid (or throws).
    const spawnTab = useCallback(async (cwd: string | null): Promise<number> => {
        const channel = new Channel<PtyEvent>();
        const { cols, rows } = dimsRef.current;
        const rid = await invoke<number>("pty_spawn", { events: channel, cols, rows, cwd });
        setTabs((prev) => [...prev, { id: rid, title: "", channel }]);
        setActiveId(rid);
        return rid;
    }, []);

    const closeTabById = useCallback((rid: number) => {
        invoke("pty_close", { rid }).catch((e) => console.error("pty_close failed", e));
    }, []);

    // Install the menu, then spawn the first tab on app launch.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const refresh = await installMenu(() => stateRef.current, {
                newTab: () => {
                    spawnTab(null).catch((e) => console.error("spawn failed", e));
                },
                closeActiveTab: () => {
                    const id = stateRef.current.activeId;
                    if (id !== null) closeTabById(id);
                },
                selectPrevTab: () => {
                    const { tabs, activeId } = stateRef.current;
                    if (tabs.length < 2 || activeId === null) return;
                    const idx = tabs.findIndex((t) => t.id === activeId);
                    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
                    setActiveId(prev.id);
                },
                selectNextTab: () => {
                    const { tabs, activeId } = stateRef.current;
                    if (tabs.length < 2 || activeId === null) return;
                    const idx = tabs.findIndex((t) => t.id === activeId);
                    const next = tabs[(idx + 1) % tabs.length];
                    setActiveId(next.id);
                },
                showTabAtIndex: (index: number) => {
                    const { tabs } = stateRef.current;
                    const t = tabs[Math.min(index, tabs.length - 1)];
                    if (t) setActiveId(t.id);
                },
            });
            if (cancelled) return;
            refreshMenuRef.current = refresh;
            // Spawn the first tab.
            await spawnTab(null);
        })().catch((e) => console.error("startup failed", e));
        return () => {
            cancelled = true;
        };
    }, []);

    // Title routing.
    useEffect(() => {
        const unlisten = listen<{ rid: number; title: string }>("pty:title", (e) => {
            setTabs((prev) =>
                prev.map((t) => (t.id === e.payload.rid ? { ...t, title: e.payload.title } : t)),
            );
        });
        return () => {
            unlisten.then((u) => u());
        };
    }, []);

    // Exit routing.
    useEffect(() => {
        const unlisten = listen<{ rid: number }>("pty:exit", (e) => {
            const closingRid = e.payload.rid;
            setTabs((prev) => {
                const next = prev.filter((t) => t.id !== closingRid);
                if (next.length === 0) {
                    queueMicrotask(() => getCurrentWindow().close());
                }
                setActiveId((current) =>
                    current === closingRid ? (next[0]?.id ?? null) : current,
                );
                return next;
            });
        });
        return () => {
            unlisten.then((u) => u());
        };
    }, []);

    const titleOpacity = useTransform(sizeMV, (v) => {
        const max = lastExpandedRef.current;
        if (max <= 0) return 1;
        return Math.max(0, Math.min(1, 1 - v / max));
    });
    const separatorWidth = useTransform(sizeMV, (v) => Math.min(SEPARATOR_PX, Math.max(0, v)));

    useMotionValueEvent(sizeMV, "change", (v) => {
        sidebarRef.current?.resize(`${v}px`);
    });

    const handleSidebarResize = (size: PanelSize) => {
        if (!isAnimatingRef.current && !collapsed && size.inPixels > 0) {
            lastExpandedRef.current = size.inPixels;
            sizeMV.set(size.inPixels);
        }
    };

    const toggle = () => {
        if (!collapsed) {
            setCollapsed(true);
            isAnimatingRef.current = true;
            animate(sizeMV, 0, {
                ...TWEEN,
                onComplete: () => {
                    isAnimatingRef.current = false;
                },
            });
        } else {
            setCollapsed(false);
            isAnimatingRef.current = true;
            animate(sizeMV, lastExpandedRef.current, {
                ...TWEEN,
                onComplete: () => {
                    isAnimatingRef.current = false;
                },
            });
        }
    };

    const activeTitle = tabs.find((t) => t.id === activeId)?.title ?? "";

    return (
        <div className="relative w-full h-full bg-accent-dark/30">
            <Group className="h-full" orientation="horizontal">
                <Panel
                    panelRef={sidebarRef}
                    defaultSize="0px"
                    minSize="0%"
                    maxSize="480px"
                    groupResizeBehavior="preserve-pixel-size"
                    className="overflow-hidden relative"
                    onResize={handleSidebarResize}
                >
                    <div className="absolute inset-0 top-11">
                        <Sidebar />
                    </div>
                </Panel>
                <MotionSeparator
                    disabled={collapsed}
                    style={{ width: separatorWidth, flexBasis: separatorWidth }}
                />
                <Panel className="relative">
                    <div className="absolute top-11 right-2 bottom-2 left-2 bg-background rounded-lg overflow-hidden border border-border">
                        {tabs.map((tab) => (
                            <Terminal
                                key={tab.id}
                                rid={tab.id}
                                channel={tab.channel}
                                active={tab.id === activeId}
                                onResize={(cols, rows) => {
                                    if (tab.id === activeId) dimsRef.current = { cols, rows };
                                }}
                            />
                        ))}
                    </div>
                </Panel>
            </Group>
            <Titlebar
                className="absolute inset-x-0 top-0 z-10"
                style={{ paddingLeft: TRAFFIC_LIGHTS_INSET_PX }}
            >
                <SidebarToggle collapsed={collapsed} onClick={toggle} />
                {tabs.length >= 2 ? (
                    <motion.div
                        style={{ opacity: titleOpacity }}
                        className="absolute inset-y-0 right-0"
                    >
                        <TabBar
                            tabs={tabs.map(({ id, title }) => ({ id, title }))}
                            activeId={activeId}
                            onActivate={setActiveId}
                            onClose={closeTabById}
                        />
                    </motion.div>
                ) : (
                    <motion.span
                        style={{ opacity: titleOpacity }}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground text-sm select-none pointer-events-none"
                    >
                        {activeTitle}
                    </motion.span>
                )}
            </Titlebar>
        </div>
    );
}

export default App;
