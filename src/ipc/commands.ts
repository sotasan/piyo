import { Channel, invoke } from "@tauri-apps/api/core";

import type {
    AppearanceMode,
    Configuration,
    KeyInput,
    MouseEventInput,
    PtySpawned,
} from "@/ipc/types";

export const getConfig = () => invoke<Configuration>("get_config");

export const getAccentColor = () => invoke<string>("get_accent_color");

export const readUserTheme = (name: string) => invoke<string | null>("read_user_theme", { name });

export const setWindowAppearance = (mode: AppearanceMode) =>
    invoke<void>("set_window_appearance", { mode });

export const ptySpawn = (
    events: Channel<ArrayBuffer>,
    cols: number,
    rows: number,
    cwd: string | null,
) => invoke<PtySpawned>("pty_spawn", { events, cols, rows, cwd });

export const ptyWrite = (rid: number, data: string) => invoke<void>("pty_write", { rid, data });

export const ptyResize = (
    rid: number,
    cols: number,
    rows: number,
    cellWidth: number,
    cellHeight: number,
) => invoke<void>("pty_resize", { rid, cols, rows, cellWidth, cellHeight });

export const ptyClose = (rid: number) => invoke<void>("pty_close", { rid });

export const ptySendKey = (rid: number, input: KeyInput) =>
    invoke<void>("pty_send_key", { rid, input });

export const ptySendMouse = (rid: number, input: MouseEventInput) =>
    invoke<void>("pty_send_mouse", { rid, input });
