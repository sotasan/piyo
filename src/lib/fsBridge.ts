import { invoke } from "@tauri-apps/api/core";

export type DirEntry = {
    name: string;
    isDir: boolean;
};

export function listDir(path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>("list_dir", { path });
}

/** Convert a DirEntry into a pierre/trees path string, with `/` for directories. */
export function entryToTreePath(parent: string, entry: DirEntry): string {
    const base = parent === "" ? entry.name : `${parent}${entry.name}`;
    return entry.isDir ? `${base}/` : base;
}
