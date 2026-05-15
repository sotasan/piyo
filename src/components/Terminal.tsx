import { useState } from "react";

import TerminalSearchBar from "@/components/TerminalSearchBar";
import { useXterm } from "@/hooks/useXterm";

type Props = {
    rid: number;
    active: boolean;
    onResize?: (cols: number, rows: number) => void;
};

function Terminal({ rid, active, onResize }: Props) {
    const [searchOpen, setSearchOpen] = useState(false);
    const { containerRef, termRef, searchRef } = useXterm({
        rid,
        active,
        onResize,
        onOpenSearch: () => setSearchOpen(true),
    });

    return (
        <div
            className="absolute inset-0 overflow-hidden bg-background"
            style={{
                visibility: active ? "visible" : "hidden",
                pointerEvents: active ? "auto" : "none",
            }}
        >
            <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
            {searchOpen && (
                <TerminalSearchBar
                    searchRef={searchRef}
                    termRef={termRef}
                    onClose={() => setSearchOpen(false)}
                />
            )}
        </div>
    );
}

export default Terminal;
