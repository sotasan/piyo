function Sidebar() {
    return (
        <aside className="h-full bg-transparent flex flex-col items-center py-2 gap-2">
            <button
                type="button"
                aria-label="New tab"
                className="w-8 h-8 border-0 rounded-md bg-transparent text-foreground inline-flex items-center justify-center hover:bg-foreground/15"
            >
                <span aria-hidden="true" className="icon-[lucide--plus] w-4 h-4" />
            </button>
        </aside>
    );
}

export default Sidebar;
