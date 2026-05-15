import { describe, expect, test } from "bun:test";

import { MOD_ALT, MOD_CTRL, MOD_SHIFT, MOD_SUPER, packMods } from "@/lib/inputModifiers";

describe("packMods", () => {
    const none = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

    test("empty modifier set packs to 0", () => {
        expect(packMods(none)).toBe(0);
    });

    test("each modifier maps to its own bit", () => {
        expect(packMods({ ...none, shiftKey: true })).toBe(MOD_SHIFT);
        expect(packMods({ ...none, ctrlKey: true })).toBe(MOD_CTRL);
        expect(packMods({ ...none, altKey: true })).toBe(MOD_ALT);
        expect(packMods({ ...none, metaKey: true })).toBe(MOD_SUPER);
    });

    test("multiple modifiers OR together", () => {
        expect(packMods({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: true })).toBe(
            MOD_SHIFT | MOD_CTRL | MOD_SUPER,
        );
    });

    test("bit positions match the Rust-side libghostty_vt::key::Mods layout", () => {
        // libghostty_vt::key::Mods uses shift/ctrl/alt/super = 1/2/4/8.
        expect(MOD_SHIFT).toBe(1);
        expect(MOD_CTRL).toBe(2);
        expect(MOD_ALT).toBe(4);
        expect(MOD_SUPER).toBe(8);
    });
});
