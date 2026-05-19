import { useFileIcon } from "@/hooks/useFileIcon";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/stores/tabs";

type Props = {
    rid: number;
    cwd: string;
    title: string;
    className?: string;
};

function TabTitle({ rid, cwd, title, className }: Props) {
    const icon = useFileIcon(cwd, 32);
    const progressActive = useTabsStore((s) => s.progress.has(rid));
    return (
        <span className={cn("flex min-w-0 items-center gap-3 select-none", className)}>
            {progressActive ? (
                <span
                    aria-hidden
                    className="icon-[lucide--loader-circle] h-4 w-4 shrink-0 animate-spin"
                />
            ) : icon ? (
                <img src={icon} alt="" className="h-4 w-4 shrink-0" />
            ) : (
                <span
                    aria-hidden
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center leading-none"
                >
                    🐥
                </span>
            )}
            <span className="truncate">{title}</span>
        </span>
    );
}

export default TabTitle;
