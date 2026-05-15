import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { PtyCwd, PtyExit, PtyModes, PtyTitle } from "@/ipc/types";

const onEvent = <T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> =>
    listen<T>(name, (e) => cb(e.payload));

export const onPtyTitle = (cb: (p: PtyTitle) => void) => onEvent("pty:title", cb);
export const onPtyCwd = (cb: (p: PtyCwd) => void) => onEvent("pty:cwd", cb);
export const onPtyExit = (cb: (p: PtyExit) => void) => onEvent("pty:exit", cb);
export const onPtyModes = (cb: (p: PtyModes) => void) => onEvent("pty:modes", cb);
export const onAccentChanged = (cb: (hex: string) => void) => onEvent<string>("accent:changed", cb);
