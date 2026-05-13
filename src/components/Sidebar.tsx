import FileTreePanel from "@/components/FileTreePanel";

function Sidebar() {
    return (
        <aside className="flex h-full flex-col overflow-hidden bg-transparent">
            <FileTreePanel />
        </aside>
    );
}

export default Sidebar;
