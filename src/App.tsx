import { motion } from "motion/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import Titlebar from "@/components/Titlebar";
import WorkspaceView from "@/components/WorkspaceView";
import "@/terminal";
import { useSidebarPanel } from "@/useSidebarPanel";
import "@/workspaceMenu";
import { useActiveTitle, useWorkspaceStore } from "@/workspaceStore";
import "@/App.css";

const TRAFFIC_LIGHTS_INSET_PX = 84;
const MotionSeparator = motion.create(Separator);

function App() {
    const sidebar = useSidebarPanel();
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const activeId = useWorkspaceStore((s) => s.activeId);
    const activeTitle = useActiveTitle();

    return (
        <div className="relative w-full h-full bg-accent-dark/30">
            <Group className="h-full" orientation="horizontal">
                <Panel
                    panelRef={sidebar.ref}
                    defaultSize="0px"
                    minSize="0%"
                    maxSize="480px"
                    groupResizeBehavior="preserve-pixel-size"
                    className="overflow-hidden relative"
                    onResize={sidebar.handleResize}
                >
                    <div className="absolute inset-0 top-11">
                        <Sidebar />
                    </div>
                </Panel>
                <MotionSeparator
                    disabled={sidebar.collapsed}
                    style={{ width: sidebar.separatorWidth, flexBasis: sidebar.separatorWidth }}
                />
                <Panel className="relative">
                    <div className="absolute top-11 right-2 bottom-2 left-2 bg-background rounded-lg overflow-hidden border border-border">
                        {workspaces.map((ws) => (
                            <div
                                key={ws.id}
                                style={{ display: ws.id === activeId ? "block" : "none" }}
                                className="absolute inset-0"
                            >
                                <WorkspaceView workspace={ws} active={ws.id === activeId} />
                            </div>
                        ))}
                    </div>
                </Panel>
            </Group>
            <Titlebar
                className="absolute inset-x-0 top-0 z-10"
                style={{ paddingLeft: TRAFFIC_LIGHTS_INSET_PX }}
            >
                <SidebarToggle collapsed={sidebar.collapsed} onClick={sidebar.toggle} />
                <motion.span
                    style={{ opacity: sidebar.titleOpacity }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground text-sm select-none pointer-events-none"
                >
                    {activeTitle}
                </motion.span>
            </Titlebar>
        </div>
    );
}

export default App;
