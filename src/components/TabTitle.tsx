import { useFileIcon } from "@/hooks/useFileIcon";
import { cn } from "@/lib/utils";

type Props = {
    cwd: string;
    title: string;
    className?: string;
};

function TabTitle({ cwd, title, className }: Props) {
    const icon = useFileIcon(cwd, 32);
    return (
        <span className={cn("flex min-w-0 items-center gap-3 select-none", className)}>
            {icon ? (
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
