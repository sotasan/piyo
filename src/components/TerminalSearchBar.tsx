import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { useState } from "react";

type Props = {
    searchRef: React.RefObject<SearchAddon | null>;
    termRef: React.RefObject<XtermTerminal | null>;
    onClose: () => void;
};

function TerminalSearchBar({ searchRef, termRef, onClose }: Props) {
    const [query, setQuery] = useState("");

    const reset = () => {
        searchRef.current?.clearDecorations();
        setQuery("");
        onClose();
        termRef.current?.focus();
    };

    return (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm shadow-lg glass">
            <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        reset();
                    } else if (e.key === "Enter") {
                        if (e.shiftKey) searchRef.current?.findPrevious(query);
                        else searchRef.current?.findNext(query);
                    }
                }}
                placeholder="Search scrollback…"
                className="w-56 bg-transparent text-foreground outline-none placeholder:text-foreground/40"
            />
        </div>
    );
}

export default TerminalSearchBar;
