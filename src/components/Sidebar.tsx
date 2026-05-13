import FileTreePanel from "@/components/FileTreePanel";

function Sidebar() {
    return (
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
            <div className="min-h-0 flex-1 overflow-auto">
                <FileTreePanel />
            </div>
        </aside>
    );
}

export default Sidebar;
