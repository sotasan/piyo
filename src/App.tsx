import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelSize } from "react-resizable-panels";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import Titlebar from "@/components/Titlebar";
import WorkspaceView from "@/components/WorkspaceView";
import { type Workspace, newWorkspace } from "@/workspaces";
import "@/App.css";

const TRAFFIC_LIGHTS_INSET_PX = 84;
const DEFAULT_SIDEBAR_PX = 200;
const SEPARATOR_PX = 4;
const TWEEN = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };
const MotionSeparator = motion.create(Separator);

function App() {
    const sidebarRef = usePanelRef();
    const [collapsed, setCollapsed] = useState(true);
    const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [newWorkspace()]);
    const [activeId, setActiveId] = useState<number>(workspaces[0].id);
    const [titles, setTitles] = useState<Record<number, string>>({});
    // cwds are tracked passively for future tab-spawn use; stored but unused in v1.
    const [, setCwds] = useState<Record<number, string>>({});
    const sizeMV = useMotionValue(0);
    const lastExpandedRef = useRef(DEFAULT_SIDEBAR_PX);
    const isAnimatingRef = useRef(false);

    useEffect(() => {
        const u1 = listen<{ id: number; title: string }>("pty:title", (e) =>
            setTitles((p) => ({ ...p, [e.payload.id]: e.payload.title })),
        );
        const u2 = listen<{ id: number; cwd: string }>("pty:cwd", (e) =>
            setCwds((p) => ({ ...p, [e.payload.id]: e.payload.cwd })),
        );
        return () => {
            u1.then((u) => u());
            u2.then((u) => u());
        };
    }, []);

    const addWorkspace = useCallback(() => {
        const ws = newWorkspace();
        setWorkspaces((prev) => [...prev, ws]);
        setActiveId(ws.id);
    }, []);

    const closeWorkspace = useCallback((id: number) => {
        setWorkspaces((prev) => {
            if (prev.length <= 1) return prev;
            const idx = prev.findIndex((w) => w.id === id);
            if (idx < 0) return prev;
            const next = prev.filter((w) => w.id !== id);
            setActiveId((current) => (current === id ? next[Math.max(0, idx - 1)].id : current));
            return next;
        });
    }, []);

    const handleTabSpawned = useCallback((workspaceId: number, tabId: number, ptyId: number) => {
        setWorkspaces((prev) =>
            prev.map((w) =>
                w.id !== workspaceId
                    ? w
                    : {
                          ...w,
                          tabs: w.tabs.map((t) => (t.id === tabId ? { ...t, ptyId } : t)),
                      },
            ),
        );
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.metaKey || e.altKey || e.ctrlKey) return;
            const key = e.key.toLowerCase();
            if (!e.shiftKey && key === "n") {
                e.preventDefault();
                addWorkspace();
                return;
            }
            if (e.shiftKey && key === "w") {
                e.preventDefault();
                closeWorkspace(activeId);
                return;
            }
            if (e.shiftKey && /^[1-9]$/.test(e.key)) {
                e.preventDefault();
                const n = Number(e.key) - 1;
                if (workspaces[n]) setActiveId(workspaces[n].id);
                return;
            }
            if (e.shiftKey && (e.key === "{" || e.key === "[")) {
                e.preventDefault();
                const i = workspaces.findIndex((w) => w.id === activeId);
                if (i < 0) return;
                setActiveId(workspaces[(i - 1 + workspaces.length) % workspaces.length].id);
                return;
            }
            if (e.shiftKey && (e.key === "}" || e.key === "]")) {
                e.preventDefault();
                const i = workspaces.findIndex((w) => w.id === activeId);
                if (i < 0) return;
                setActiveId(workspaces[(i + 1) % workspaces.length].id);
                return;
            }
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () => window.removeEventListener("keydown", onKey, { capture: true });
    }, [activeId, workspaces, addWorkspace, closeWorkspace]);

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

    const activeWs = workspaces.find((w) => w.id === activeId);
    const activeTab = activeWs?.tabs.find((t) => t.id === activeWs.activeTabId);
    const activeTitle = activeTab?.ptyId != null ? (titles[activeTab.ptyId] ?? "") : "";

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
                        <Sidebar
                            workspaces={workspaces}
                            activeId={activeId}
                            titles={titles}
                            onActivate={setActiveId}
                            onClose={closeWorkspace}
                        />
                    </div>
                </Panel>
                <MotionSeparator
                    disabled={collapsed}
                    style={{ width: separatorWidth, flexBasis: separatorWidth }}
                />
                <Panel className="relative">
                    <div className="absolute top-11 right-2 bottom-2 left-2 bg-background rounded-lg overflow-hidden border border-border">
                        {workspaces.map((ws) => (
                            <div
                                key={ws.id}
                                style={{ display: ws.id === activeId ? "block" : "none" }}
                                className="absolute inset-0"
                            >
                                <WorkspaceView
                                    workspace={ws}
                                    active={ws.id === activeId}
                                    onTabSpawned={(tabId, ptyId) =>
                                        handleTabSpawned(ws.id, tabId, ptyId)
                                    }
                                />
                            </div>
                        ))}
                    </div>
                </Panel>
            </Group>
            <Titlebar
                className="absolute inset-x-0 top-0 z-10"
                style={{ paddingLeft: TRAFFIC_LIGHTS_INSET_PX }}
            >
                <SidebarToggle collapsed={collapsed} onClick={toggle} />
                <motion.span
                    style={{ opacity: titleOpacity }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground text-sm select-none pointer-events-none"
                >
                    {activeTitle}
                </motion.span>
            </Titlebar>
        </div>
    );
}

export default App;
