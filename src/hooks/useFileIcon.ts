import { useAccentStore } from "@/stores/accent";

export function useFileIcon(path: string, size = 32): string {
    const v = useAccentStore((s) => s.hex);
    if (!path) return "";
    const url = new URL("icon://localhost");
    url.pathname = path;
    url.searchParams.set("size", String(size));
    url.searchParams.set("v", v);
    return url.toString();
}
