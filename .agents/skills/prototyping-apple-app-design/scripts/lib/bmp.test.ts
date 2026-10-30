import assert from "node:assert/strict";
import test from "node:test";

import { type Bitmap, dominantCoverage, parseBmp } from "./bmp.ts";

/** A 24-bit BMP with the header fields these scripts actually read. */
function makeBmp(
    width: number,
    height: number,
    pixels: readonly (readonly [number, number, number])[][],
): Buffer {
    const step = 3;
    const stride = Math.floor((width * step + 3) / 4) * 4;
    const offset = 54;
    const data = Buffer.alloc(offset + stride * Math.abs(height));
    data.writeUInt32LE(offset, 10);
    data.writeInt32LE(width, 18);
    data.writeInt32LE(height, 22);
    data.writeUInt16LE(24, 28);
    for (const [y, row] of pixels.entries()) {
        for (const [x, pixel] of row.entries()) {
            const start = offset + y * stride + x * step;
            // Stored BGR.
            data[start] = pixel[2];
            data[start + 1] = pixel[1];
            data[start + 2] = pixel[0];
        }
    }
    return data;
}

const RED: readonly [number, number, number] = [255, 0, 0];
const BLUE: readonly [number, number, number] = [0, 0, 255];

test("swaps BGR to RGB and drops the padding", () => {
    const bitmap = parseBmp(makeBmp(2, -1, [[RED, BLUE]]));
    assert.equal(bitmap.width, 2);
    assert.equal(bitmap.height, 1);
    assert.deepEqual([...(bitmap.rows[0] ?? [])], [255, 0, 0, 0, 0, 255]);
});

test("a positive height means the rows are stored bottom-up", () => {
    const bottomUp = parseBmp(makeBmp(1, 2, [[RED], [BLUE]]));
    assert.deepEqual([...(bottomUp.rows[0] ?? [])], [0, 0, 255]);
    const topDown = parseBmp(makeBmp(1, -2, [[RED], [BLUE]]));
    assert.deepEqual([...(topDown.rows[0] ?? [])], [255, 0, 0]);
});

test("a depth this script cannot read is named in the error", () => {
    const data = makeBmp(1, -1, [[RED]]);
    data.writeUInt16LE(8, 28);
    assert.throws(() => parseBmp(data, "probe.bmp"), /unexpected BMP depth 8 in probe\.bmp/);
});

function bitmap(rows: readonly (readonly [number, number, number])[][]): Bitmap {
    return {
        width: rows[0]?.length ?? 0,
        height: rows.length,
        rows: rows.map(row => Buffer.from(row.flat())),
    };
}

test("a solid frame is entirely one colour", () => {
    const black: readonly [number, number, number] = [0, 0, 0];
    assert.equal(
        dominantCoverage(
            bitmap([
                [black, black],
                [black, black],
            ]),
        ),
        1,
    );
});

test("near-identical colours fall in the same bucket", () => {
    // 24-wide buckets: a launch frame's slight gradient still reads as one colour.
    const coverage = dominantCoverage(
        bitmap([
            [
                [0, 0, 0],
                [10, 10, 10],
                [20, 20, 20],
                [23, 23, 23],
            ],
        ]),
    );
    assert.equal(coverage, 1);
});

test("a black frame with a white status bar is not one colour", () => {
    // The case that defeats a colour-*range* check: full range, nothing rendered. Here
    // the dominant colour still covers three quarters, which is below the 0.92 cutoff.
    const black: readonly [number, number, number] = [0, 0, 0];
    const white: readonly [number, number, number] = [255, 255, 255];
    const coverage = dominantCoverage(bitmap([[black, black, black, white]]));
    assert.equal(coverage, 0.75);
    assert.ok(coverage < 0.92);
});

test("an empty bitmap has no dominant colour", () => {
    assert.equal(dominantCoverage({ width: 0, height: 0, rows: [] }), 0);
});
