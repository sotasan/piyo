import { describe, expect, test } from "bun:test";

import { cn } from "@/lib/utils";

describe("cn", () => {
    test("joins simple class strings", () => {
        expect(cn("a", "b", "c")).toBe("a b c");
    });

    test("filters falsy values", () => {
        expect(cn("a", false, null, undefined, "b", 0, "")).toBe("a b");
    });

    test("supports conditional object syntax via clsx", () => {
        expect(cn({ a: true, b: false, c: true })).toBe("a c");
    });

    test("deduplicates conflicting tailwind utilities (twMerge)", () => {
        // The later utility should win for conflicting padding classes.
        expect(cn("p-2", "p-4")).toBe("p-4");
    });

    test("preserves non-conflicting tailwind utilities", () => {
        expect(cn("text-sm", "font-mono")).toBe("text-sm font-mono");
    });
});
