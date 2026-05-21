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

/** mirrors `crate::pty::PtyCwd` */
export type PtyCwd = {
    rid: number;
    cwd: string;
};

/** mirrors `crate::pty::PtyExit` */
export type PtyExit = {
    rid: number;
};

/** mirrors `crate::pty::PtyPassword` */
export type PtyPassword = {
    rid: number;
    active: boolean;
};
