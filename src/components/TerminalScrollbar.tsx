import { useCallback, useEffect, useRef, useState } from "react";

import { commands } from "@/gen/bindings";
import type { ScrollInfo } from "@/lib/xtermGhostty";

type Props = {
    rid: number;
    viewportRows: number;
    info: ScrollInfo | null;
};

/** Custom scrollbar overlay driven by ghostty's scrollback state. The native
 *  xterm.js scrollbar can't be used because ghostty owns the scrollback;
 *  this component reads `scrollbackRows` / `viewportOffset` from each frame
 *  and translates drag gestures back into `pty_scroll_to` commands. */
function TerminalScrollbar({ rid, viewportRows, info }: Props) {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragOriginRef = useRef<{ clientY: number; offset: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const total = (info?.scrollbackRows ?? 0) + viewportRows;
    const visible = total > viewportRows;
    const thumbHeightPct = visible ? Math.max(8, (viewportRows / total) * 100) : 100;
    // viewportOffset is "rows scrolled up from active bottom"; convert to
    // distance from the top of the track.
    const offset = info?.viewportOffset ?? 0;
    const maxOffset = info?.scrollbackRows ?? 0;
    const topPct =
        maxOffset > 0
            ? ((maxOffset - offset) / maxOffset) * (100 - thumbHeightPct)
            : 100 - thumbHeightPct;

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!visible) return;
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragOriginRef.current = { clientY: e.clientY, offset };
            setDragging(true);
        },
        [offset, visible],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const origin = dragOriginRef.current;
            const track = trackRef.current;
            if (!origin || !track || !visible) return;
            const trackHeight = track.clientHeight;
            const thumbHeight = (thumbHeightPct / 100) * trackHeight;
            const scrollable = trackHeight - thumbHeight;
            if (scrollable <= 0) return;
            const deltaPx = e.clientY - origin.clientY;
            // Drag down = scroll toward bottom = decrease offset.
            const deltaRows = (deltaPx / scrollable) * maxOffset;
            const next = Math.max(0, Math.min(maxOffset, origin.offset - deltaRows));
            void commands.ptyScrollTo(rid, Math.round(next));
        },
        [maxOffset, rid, thumbHeightPct, visible],
    );

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        dragOriginRef.current = null;
        setDragging(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }, []);

    // Click on track (above/below thumb) → page-scroll one viewport.
    const onTrackClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!visible) return;
            const track = trackRef.current;
            if (!track || e.target !== track) return;
            const rect = track.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const thumbTop = (topPct / 100) * rect.height;
            const direction = clickY < thumbTop ? 1 : -1; // up scrolls back in history
            const page = Math.max(1, viewportRows - 1);
            const next = Math.max(0, Math.min(maxOffset, offset + direction * page));
            void commands.ptyScrollTo(rid, next);
        },
        [maxOffset, offset, rid, topPct, viewportRows, visible],
    );

    // Hide when there's nothing to scroll; otherwise fade in on hover/drag.
    useEffect(() => {
        if (!visible) setDragging(false);
    }, [visible]);

    if (!visible) return null;

    return (
        <div
            ref={trackRef}
            onClick={onTrackClick}
            className="group absolute top-0 right-0 z-10 h-full w-2 cursor-default"
        >
            <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                    top: `${topPct}%`,
                    height: `${thumbHeightPct}%`,
                }}
                className={`absolute right-0.5 w-1.5 rounded-full bg-foreground/30 transition-opacity ${
                    dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
            />
        </div>
    );
}

export default TerminalScrollbar;
