import { describe, expect, test } from "bun:test";

import { BinaryDecoder } from "@/lib/binaryDecoder";

function toView(bytes: number[]): DataView {
    return new DataView(new Uint8Array(bytes).buffer);
}

describe("BinaryDecoder", () => {
    test("u8 advances the cursor by one byte", () => {
        const d = new BinaryDecoder(toView([0x01, 0x02, 0x03]));
        expect(d.u8()).toBe(0x01);
        expect(d.u8()).toBe(0x02);
        expect(d.u8()).toBe(0x03);
    });

    test("u16 reads little-endian", () => {
        const d = new BinaryDecoder(toView([0x34, 0x12]));
        expect(d.u16()).toBe(0x1234);
    });

    test("u32 reads little-endian", () => {
        const d = new BinaryDecoder(toView([0x78, 0x56, 0x34, 0x12]));
        expect(d.u32()).toBe(0x12345678);
    });

    test("i32 reads signed little-endian", () => {
        // -1 in two's complement = 0xFFFFFFFF
        const d = new BinaryDecoder(toView([0xff, 0xff, 0xff, 0xff]));
        expect(d.i32()).toBe(-1);
    });

    test("rgb returns a 3-tuple in [r, g, b] order", () => {
        const d = new BinaryDecoder(toView([10, 20, 30]));
        expect(d.rgb()).toEqual([10, 20, 30]);
    });

    test("utf8 decodes a length-prefixed slice", () => {
        // "é" in UTF-8 is [0xc3, 0xa9]
        const d = new BinaryDecoder(toView([0xc3, 0xa9]));
        expect(d.utf8(2)).toBe("é");
    });

    test("skip advances without reading", () => {
        const d = new BinaryDecoder(toView([1, 2, 3, 4]));
        d.skip(3);
        expect(d.u8()).toBe(4);
    });

    test("bytes returns a view that respects the underlying buffer offset", () => {
        const d = new BinaryDecoder(toView([1, 2, 3, 4, 5]));
        d.u8();
        const slice = d.bytes(3);
        expect(Array.from(slice)).toEqual([2, 3, 4]);
        expect(d.u8()).toBe(5);
    });

    test("mixed reads progress through the buffer sequentially", () => {
        // [u8 = 0x42][u16 le = 0x1234][u32 le = 0xdeadbeef]
        const d = new BinaryDecoder(toView([0x42, 0x34, 0x12, 0xef, 0xbe, 0xad, 0xde]));
        expect(d.u8()).toBe(0x42);
        expect(d.u16()).toBe(0x1234);
        expect(d.u32()).toBe(0xdeadbeef);
    });
});
