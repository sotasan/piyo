import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
};

function Titlebar({ children, className, style }: Props) {
    return (
        <div
            data-tauri-drag-region
            style={style}
            className={cn("flex h-10 shrink-0 items-center", className)}
        >
            {children}
        </div>
    );
}

export default Titlebar;
