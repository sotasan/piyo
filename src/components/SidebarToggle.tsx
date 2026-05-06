type Props = {
  onClick: () => void;
};

function SidebarToggle({ onClick }: Props) {
  return (
    <button
      type="button"
      aria-label="Toggle sidebar"
      onClick={onClick}
      data-tauri-drag-region={false}
      className="w-7 h-7 flex items-center justify-center rounded-md border-0 bg-transparent text-[#a9b1d6] hover:bg-[#a9b1d6]/15"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <line
          x1="6"
          y1="3"
          x2="6"
          y2="13"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    </button>
  );
}

export default SidebarToggle;
