import Terminal from "@/components/Terminal";
import type { Workspace } from "@/workspaces";

type Props = {
    workspace: Workspace;
    active: boolean;
    onTabSpawned: (tabId: number, ptyId: number) => void;
};

function WorkspaceView({ workspace, active, onTabSpawned }: Props) {
    return (
        <div className="absolute inset-0">
            {workspace.tabs.map((tab) => (
                <div
                    key={tab.id}
                    style={{ display: tab.id === workspace.activeTabId ? "block" : "none" }}
                    className="absolute inset-0"
                >
                    <Terminal
                        active={active && tab.id === workspace.activeTabId}
                        onSpawned={(ptyId) => onTabSpawned(tab.id, ptyId)}
                    />
                </div>
            ))}
        </div>
    );
}

export default WorkspaceView;
