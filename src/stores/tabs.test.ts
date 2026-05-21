import { describe, expect, test } from "bun:test";

import type { Tab } from "@/stores/tabs";

describe("Tab type", () => {
    test("includes workspaceId", () => {
        const t: Tab = { id: 1, title: "fish", workspaceId: 0 };
        expect(t.workspaceId).toBe(0);
    });
});
