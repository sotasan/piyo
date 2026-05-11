import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelSize } from "react-resizable-panels";

import CommandPalette from "@/components/CommandPalette";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import TabBar from "@/components/TabBar";
import Terminal from "@/components/Terminal";
import Titlebar from "@/components/Titlebar";
import { useFileIcon } from "@/hooks/useFileIcon";
import { useTabsLifecycle } from "@/hooks/useTabsLifecycle";
import { useTabsStore } from "@/stores/tabs";

import "@/App.css";

const DEFAULT_SIDEBAR_PX = 200;
const SEPARATOR_PX = 4;
const TWEEN = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };
const MotionSeparator = motion.create(Separator);

function App() {
    const sidebarRef = usePanelRef();
    const [collapsed, setCollapsed] = useState(true);
    const sizeMV = useMotionValue(0);
    const lastExpandedRef = useRef(DEFAULT_SIDEBAR_PX);
    const isAnimatingRef = useRef(false);

    useTabsLifecycle();
    const tabs = useTabsStore((s) => s.tabs);
    const activeId = useTabsStore((s) => s.activeId);
    const cwds = useTabsStore((s) => s.cwds);
    const activate = useTabsStore((s) => s.activate);
    const closeTab = useTabsStore((s) => s.close);
    const reorder = useTabsStore((s) => s.reorder);
    const setDims = useTabsStore((s) => s.setDims);

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
    const activeCwd = activeId !== null ? (cwds.get(activeId) ?? "") : "";
    const activeIcon = useFileIcon(activeCwd, 32);

    return (
        <div className="relative h-full w-full bg-accent-dark/30">
            <Group className="h-full" orientation="horizontal">
                <Panel
                    panelRef={sidebarRef}
                    defaultSize="0px"
                    minSize="0%"
                    maxSize="480px"
                    groupResizeBehavior="preserve-pixel-size"
                    className="relative overflow-hidden"
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
                    <div className="absolute top-11 right-2 bottom-2 left-2 overflow-hidden rounded-lg border border-border bg-background">
                        {tabs.map((tab) => (
                            <Terminal
                                key={tab.id}
                                rid={tab.id}
                                channel={tab.channel}
                                active={tab.id === activeId}
                                onResize={(cols, rows) => {
                                    if (tab.id === activeId) setDims(cols, rows);
                                }}
                            />
                        ))}
                    </div>
                </Panel>
            </Group>
            <Titlebar className="absolute inset-x-0 top-0 z-10">
                <SidebarToggle collapsed={collapsed} onClick={toggle} />
                {tabs.length >= 2 ? (
                    <TabBar
                        tabs={tabs.map(({ id, title }) => ({
                            id,
                            title,
                            cwd: cwds.get(id) ?? null,
                        }))}
                        activeId={activeId}
                        onActivate={activate}
                        onClose={closeTab}
                        onReorder={reorder}
                    />
                ) : (
                    <div className="pointer-events-none flex flex-1 items-center justify-center gap-2">
                        {activeIcon && <img src={activeIcon} alt="" className="h-4 w-4" />}
                        <span className="text-sm text-foreground select-none">{activeTitle}</span>
                    </div>
                )}
            </Titlebar>
            <CommandPalette />
        </div>
    );
}

export default App;
