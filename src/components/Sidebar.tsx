function Sidebar() {
  return (
    <aside className="h-full bg-transparent flex flex-col items-center py-2 gap-2">
      <button
        type="button"
        aria-label="New tab"
        className="w-8 h-8 border-0 rounded-md bg-transparent text-[#a9b1d6] text-lg leading-none cursor-pointer hover:bg-[#a9b1d6]/15"
      >
        +
      </button>
    </aside>
  );
}

export default Sidebar;
