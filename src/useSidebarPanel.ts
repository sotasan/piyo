import { useRef, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { type PanelSize, usePanelRef } from "react-resizable-panels";

const DEFAULT_PX = 200;
const SEPARATOR_PX = 4;
const TWEEN = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };

export function useSidebarPanel() {
    const ref = usePanelRef();
    const [collapsed, setCollapsed] = useState(true);
    const size = useMotionValue(0);
    const lastExpanded = useRef(DEFAULT_PX);
    const animating = useRef(false);

    useMotionValueEvent(size, "change", (v) => {
        ref.current?.resize(`${v}px`);
    });

    const titleOpacity = useTransform(size, (v) => {
        const max = lastExpanded.current;
        if (max <= 0) return 1;
        return Math.max(0, Math.min(1, 1 - v / max));
    });
    const separatorWidth = useTransform(size, (v) => Math.min(SEPARATOR_PX, Math.max(0, v)));

    const handleResize = (s: PanelSize) => {
        if (!animating.current && !collapsed && s.inPixels > 0) {
            lastExpanded.current = s.inPixels;
            size.set(s.inPixels);
        }
    };

    const toggle = () => {
        const target = collapsed ? lastExpanded.current : 0;
        setCollapsed(!collapsed);
        animating.current = true;
        animate(size, target, {
            ...TWEEN,
            onComplete: () => {
                animating.current = false;
            },
        });
    };

    return { ref, collapsed, separatorWidth, titleOpacity, handleResize, toggle };
}
