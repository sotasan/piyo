/**
 * Wire types crossing the Rust ↔ TS boundary. These are the source of
 * truth on the TS side and must stay in sync with the matching Rust
 * structs (linked in each comment). Plain `type` aliases — no codegen.
 */

/** mirrors `crate::config::Configuration` */
export type Configuration = {
    font_family: string;
    font_size: number;
    theme: string;
    terminal: TerminalConfig;
};

/** mirrors `crate::config::TerminalConfig` */
export type TerminalConfig = {
    padding: string;
};

/** mirrors `crate::appearance::Mode` */
export type AppearanceMode = "light" | "dark";

/** mirrors `crate::pty::PtySpawned` */
export type PtySpawned = {
    rid: number;
    shell: string;
};

/** mirrors `crate::pty::KeyInput` */
export type KeyInput = {
    code: string;
    mods: number;
    text: string | null;
    unshifted: number | null;
    action: number;
};

/** mirrors `crate::pty::MouseSize` */
export type MouseSize = {
    screenWidth: number;
    screenHeight: number;
    cellWidth: number;
    cellHeight: number;
};

/** mirrors `crate::pty::MouseEventInput` */
export type MouseEventInput = {
    action: number;
    button: number | null;
    mods: number;
    x: number;
    y: number;
    size: MouseSize;
    anyPressed: boolean;
};

/** mirrors `crate::pty::PtyTitle` */
export type PtyTitle = {
    rid: number;
    title: string;
};

/** mirrors `crate::pty::PtyCwd` */
export type PtyCwd = {
    rid: number;
    cwd: string;
};

/** mirrors `crate::pty::PtyExit` */
export type PtyExit = {
    rid: number;
};

/** mirrors `crate::pty::PtyModes` */
export type PtyModes = {
    rid: number;
    mouseTracking: boolean;
    bracketedPaste: boolean;
    focusEvent: boolean;
};

/** mirrors `crate::pty::PtyBell` */
export type PtyBell = {
    rid: number;
};
