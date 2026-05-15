/**
 * Shared input encoding constants. Mirrors `libghostty_vt::key::Mods` bit
 * positions (shift/ctrl/alt/super = 1/2/4/8) and the action discriminator
 * Rust expects on `KeyInput.action` / `MouseEventInput.action`.
 */
export const MOD_SHIFT = 1 << 0;
export const MOD_CTRL = 1 << 1;
export const MOD_ALT = 1 << 2;
export const MOD_SUPER = 1 << 3;

export const ACTION_PRESS = 0;
export const ACTION_RELEASE = 1;
export const MOUSE_ACTION_MOTION = 2;

type ModifierEvent = {
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
};

export function packMods(e: ModifierEvent): number {
    return (
        (e.shiftKey ? MOD_SHIFT : 0) |
        (e.ctrlKey ? MOD_CTRL : 0) |
        (e.altKey ? MOD_ALT : 0) |
        (e.metaKey ? MOD_SUPER : 0)
    );
}
