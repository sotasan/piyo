import Terminal from "@/components/Terminal";
import type { Workspace } from "@/workspaceStore";

type Props = {
    workspace: Workspace;
    active: boolean;
};

function WorkspaceView({ workspace, active }: Props) {
    return (
        <div className="absolute inset-0">
            {workspace.tabs.map((tab) => (
                <div
                    key={tab.id}
                    style={{ display: tab.id === workspace.activeTabId ? "block" : "none" }}
                    className="absolute inset-0"
                >
                    <Terminal tabId={tab.id} active={active && tab.id === workspace.activeTabId} />
                </div>
            ))}
        </div>
    );
}

export default WorkspaceView;
