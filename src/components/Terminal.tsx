import { useEffect, useRef } from "react";
import { TerminalSession } from "@/terminal";

type Props = {
    tabId: number;
    active: boolean;
};

function Terminal({ tabId, active }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<TerminalSession | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const session = new TerminalSession(tabId, container);
        sessionRef.current = session;
        return () => {
            session.dispose();
            sessionRef.current = null;
        };
    }, [tabId]);

    useEffect(() => {
        if (!active) return;
        return sessionRef.current?.focusWhenReady();
    }, [active]);

    return <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-background" />;
}

export default Terminal;
