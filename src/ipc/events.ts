import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { PtyCwd, PtyExit, PtyPassword } from "@/ipc/types";

const onEvent = <T>(name: string, cb: (payload: T) => void): Promise<UnlistenFn> =>
    listen<T>(name, (e) => cb(e.payload));

export const onPtyCwd = (cb: (p: PtyCwd) => void) => onEvent("pty:cwd", cb);
export const onPtyExit = (cb: (p: PtyExit) => void) => onEvent("pty:exit", cb);
export const onPtyPassword = (cb: (p: PtyPassword) => void) => onEvent("pty:password", cb);
export const onAccentChanged = (cb: (hex: string) => void) => onEvent<string>("accent:changed", cb);
