import { describe, expect, test } from "bun:test";

import { pickLanguage } from "@/lib/i18n";

describe("pickLanguage", () => {
    test("null falls back to english", () => {
        expect(pickLanguage(null)).toBe("en");
    });

    test("exact base tags are accepted", () => {
        expect(pickLanguage("en")).toBe("en");
        expect(pickLanguage("de")).toBe("de");
        expect(pickLanguage("ja")).toBe("ja");
        expect(pickLanguage("zh")).toBe("zh");
    });

    test("region-qualified BCP-47 tags reduce to their base", () => {
        expect(pickLanguage("en-US")).toBe("en");
        expect(pickLanguage("de-AT")).toBe("de");
        expect(pickLanguage("zh-Hant-TW")).toBe("zh");
    });

    test("POSIX-style underscored locales reduce to their base", () => {
        expect(pickLanguage("en_US.UTF-8")).toBe("en");
        expect(pickLanguage("ja_JP")).toBe("ja");
    });

    test("uppercase tags are normalised", () => {
        expect(pickLanguage("EN-US")).toBe("en");
    });

    test("unsupported locales fall back to english", () => {
        expect(pickLanguage("fr")).toBe("en");
        expect(pickLanguage("ko-KR")).toBe("en");
    });
});
