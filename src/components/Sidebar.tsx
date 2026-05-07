function Sidebar() {
  return (
    <aside className="h-full bg-transparent flex flex-col items-center py-2 gap-2">
      <button
        type="button"
        aria-label="New tab"
        className="w-8 h-8 border-0 rounded-md bg-transparent text-foreground text-lg leading-none hover:bg-foreground/15"
      >
        +
      </button>
    </aside>
  );
}

export default Sidebar;
