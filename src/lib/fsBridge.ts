import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

export type FsEvent = {
    rid: number;
    kind: "create" | "remove" | "rename";
    path: string;
    isDir: boolean;
    fromPath?: string;
};

export function fsWatchStart(rid: number, path: string): Promise<void> {
    return invoke<void>("fs_watch_start", { rid, path });
}

export function fsWatchStop(rid: number): Promise<void> {
    return invoke<void>("fs_watch_stop", { rid });
}

export function subscribeFsEvents(handler: (event: FsEvent) => void): Promise<UnlistenFn> {
    return listen<FsEvent>("fs:event", (e) => handler(e.payload));
}
