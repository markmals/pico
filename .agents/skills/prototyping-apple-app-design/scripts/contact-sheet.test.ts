import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

import type { Bitmap } from "./lib/bmp.ts";

import { columnCount, composeSheet, encodePng } from "./contact-sheet.ts";

const GAP = 12;
const BG = 28;

function tile(width: number, height: number, colour: readonly [number, number, number]): Bitmap {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x += 1) {
        row[x * 3] = colour[0];
        row[x * 3 + 1] = colour[1];
        row[x * 3 + 2] = colour[2];
    }
    return { width, height, rows: Array.from({ length: height }, () => Buffer.from(row)) };
}

test("--columns wins when it is given", () => {
    assert.equal(columnCount(9, 6), 6);
    assert.equal(columnCount(2, 6), 6);
});

test("otherwise the grid is a little wider than square", () => {
    assert.equal(columnCount(1, 0), 1);
    assert.equal(columnCount(2, 0), 2);
    assert.equal(columnCount(4, 0), 3);
    assert.equal(columnCount(9, 0), 4);
    assert.equal(columnCount(16, 0), 5);
});

test("never more columns than tiles", () => {
    assert.equal(columnCount(2, 0), 2);
    assert.equal(columnCount(1, 0), 1);
});

test("the sheet is cells plus gutters, including the outer margin", () => {
    const sheet = composeSheet(
        [tile(10, 20, [255, 0, 0]), tile(10, 20, [0, 255, 0]), tile(10, 20, [0, 0, 255])],
        2,
    );
    assert.equal(sheet.columns, 2);
    assert.equal(sheet.rows, 2);
    assert.equal(sheet.width, 2 * 10 + GAP * 3);
    assert.equal(sheet.height, 2 * 20 + GAP * 3);
});

test("a ragged last row still gets a full cell", () => {
    const sheet = composeSheet([tile(10, 20, [255, 0, 0]), tile(10, 30, [0, 255, 0])], 1);
    // Cells are sized by the largest tile, so nothing is cropped.
    assert.equal(sheet.height, 2 * 30 + GAP * 3);
});

test("tiles land in reading order on the background colour", () => {
    const sheet = composeSheet([tile(2, 1, [255, 0, 0]), tile(2, 1, [0, 0, 255])], 2);
    const stride = sheet.width * 3 + 1;
    const pixel = (x: number, y: number): number[] => {
        const start = y * stride + 1 + x * 3;
        return [...sheet.raw.subarray(start, start + 3)];
    };
    assert.deepEqual(pixel(0, 0), [BG, BG, BG], "the outer margin is the background");
    assert.deepEqual(pixel(GAP, GAP), [255, 0, 0], "first tile at the top left");
    assert.deepEqual(pixel(GAP + 2 + GAP, GAP), [0, 0, 255], "second tile one cell across");
    assert.equal(sheet.raw[GAP * stride], 0, "every scanline carries filter byte 0");
});

test("composing nothing is an error, not an empty PNG", () => {
    assert.throws(() => composeSheet([], 0), /no tiles to compose/);
});

test("writes a truecolour 8-bit PNG whose IDAT round-trips", () => {
    const sheet = composeSheet([tile(2, 2, [1, 2, 3])], 1);
    const png = encodePng(sheet.width, sheet.height, sheet.raw);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.subarray(12, 16).toString("latin1"), "IHDR");
    assert.equal(png.readUInt32BE(16), sheet.width);
    assert.equal(png.readUInt32BE(20), sheet.height);
    assert.equal(png[24], 8, "bit depth");
    assert.equal(png[25], 2, "colour type: truecolour");

    const idatLength = png.readUInt32BE(33);
    const idat = png.subarray(41, 41 + idatLength);
    assert.ok(inflateSync(idat).equals(sheet.raw));
    assert.equal(png.subarray(png.length - 8, png.length - 4).toString("latin1"), "IEND");
});
