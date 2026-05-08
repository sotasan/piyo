import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelSize } from "react-resizable-panels";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import Terminal from "@/components/Terminal";
import Titlebar from "@/components/Titlebar";
import "@/App.css";

const TRAFFIC_LIGHTS_INSET_PX = 84;
const DEFAULT_SIDEBAR_PX = 200;
const TWEEN = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };

function App() {
    const sidebarRef = usePanelRef();
    const [collapsed, setCollapsed] = useState(true);
    const [title, setTitle] = useState("");
    const sizeMV = useMotionValue(0);
    const lastExpandedRef = useRef(DEFAULT_SIDEBAR_PX);
    const isAnimatingRef = useRef(false);
    const terminalRef = useRef(<Terminal />);

    useEffect(() => {
        const unlisten = listen<string>("pty:title", (e) => setTitle(e.payload));
        return () => {
            unlisten.then((u) => u());
        };
    }, []);

    const titleOpacity = useTransform(sizeMV, (v) => {
        const max = lastExpandedRef.current;
        if (max <= 0) return 1;
        return Math.max(0, Math.min(1, 1 - v / max));
    });

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
            isAnimatingRef.current = true;
            animate(sizeMV, 0, {
                ...TWEEN,
                onComplete: () => {
                    isAnimatingRef.current = false;
                    setCollapsed(true);
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
                {!collapsed && <Separator />}
                <Panel className="relative">
                    <div className="absolute top-11 right-2 bottom-2 left-2 bg-surface rounded-lg overflow-hidden border border-border">
                        {terminalRef.current}
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
                    {title}
                </motion.span>
            </Titlebar>
        </div>
    );
}

export default App;
