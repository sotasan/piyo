/**
 * Cursor-style reader for the packed binary frames produced by
 * `src-tauri/src/wire.rs`. All multi-byte fields are little-endian and the
 * underlying `DataView` carries the offset state.
 */

export type Rgb = readonly [number, number, number];

export class BinaryDecoder {
    private offset = 0;
    private readonly view: DataView;

    constructor(view: DataView) {
        this.view = view;
    }

    u8(): number {
        const v = this.view.getUint8(this.offset);
        this.offset += 1;
        return v;
    }

    u16(): number {
        const v = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return v;
    }

    u32(): number {
        const v = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }

    i32(): number {
        const v = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return v;
    }

    rgb(): Rgb {
        const r = this.u8();
        const g = this.u8();
        const b = this.u8();
        return [r, g, b];
    }

    bytes(len: number): Uint8Array {
        const v = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
        this.offset += len;
        return v;
    }

    utf8(len: number): string {
        return new TextDecoder().decode(this.bytes(len));
    }

    skip(len: number): void {
        this.offset += len;
    }
}
