import { beforeEach, describe, expect, test } from "bun:test";

import {
    clearPtyModes,
    getPtyModes,
    onPtyModesChange,
    setPtyModes,
    type PtyTermModes,
} from "@/lib/ptyModes";

const RID = 9999;
const ON: PtyTermModes = { mouseTracking: true, bracketedPaste: true, focusEvent: true };
const OFF: PtyTermModes = { mouseTracking: false, bracketedPaste: false, focusEvent: false };

describe("ptyModes store", () => {
    beforeEach(() => {
        clearPtyModes(RID);
    });

    test("getPtyModes returns defaults for unknown rids", () => {
        expect(getPtyModes(RID)).toEqual(OFF);
    });

    test("setPtyModes persists the latest value", () => {
        setPtyModes(RID, ON);
        expect(getPtyModes(RID)).toEqual(ON);
    });

    test("subscribers fire only on actual transitions", () => {
        const calls: PtyTermModes[] = [];
        const unsub = onPtyModesChange(RID, (m) => calls.push(m));
        setPtyModes(RID, ON);
        setPtyModes(RID, ON); // same value — should not fire again
        setPtyModes(RID, OFF);
        unsub();
        expect(calls).toEqual([ON, OFF]);
    });

    test("clearPtyModes drops state for the rid", () => {
        setPtyModes(RID, ON);
        clearPtyModes(RID);
        expect(getPtyModes(RID)).toEqual(OFF);
    });

    test("unsubscribed callbacks do not receive further updates", () => {
        let count = 0;
        const unsub = onPtyModesChange(RID, () => {
            count += 1;
        });
        setPtyModes(RID, ON);
        unsub();
        setPtyModes(RID, OFF);
        expect(count).toBe(1);
    });
});
