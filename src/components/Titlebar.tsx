import type { CSSProperties, ReactNode } from "react";

type Props = {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
};

function Titlebar({ children, className = "", style }: Props) {
    return (
        <div
            data-tauri-drag-region
            style={style}
            className={`h-11 shrink-0 flex items-center ${className}`}
        >
            {children}
        </div>
    );
}

export default Titlebar;
