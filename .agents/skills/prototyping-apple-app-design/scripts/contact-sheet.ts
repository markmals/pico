/**
 * Compose captures into one grid image, so a variant/state matrix can be compared in a
 * single look instead of opened one file at a time.
 *
 *   bun .agents/skills/prototyping-apple-app-design/scripts/contact-sheet.ts --project DIR --out /tmp/sheet.png
 *   bun .agents/skills/prototyping-apple-app-design/scripts/contact-sheet.ts --out /tmp/today.png DIR/.shots/today-*.png
 *
 * Prints the cell order so each tile can be named when discussing the sheet.
 * Reviewing the sheet replaces neither reading a full-size capture when something looks
 * wrong, nor the checks in REFERENCE.md "Reading a capture".
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { crc32, deflateSync } from "node:zlib";

import { type Bitmap, parseBmp } from "./lib/bmp.ts";
import { ExitError, type OptionConfig, die, rejectArgs, runMain } from "./lib/cli.ts";

const GAP = 12;
const BG = 28;
const DEFAULT_CELL_WIDTH = 320;

const OPTIONS = {
    out: { type: "string" },
    columns: { type: "string" },
    "cell-width": { type: "string" },
    project: { type: "string" },
} as const satisfies Record<string, OptionConfig>;

export type Sheet = {
    readonly width: number;
    readonly height: number;
    readonly columns: number;
    readonly rows: number;
    /** PNG scanlines: each row prefixed with filter byte 0. */
    readonly raw: Buffer;
};

/**
 * Columns for `count` tiles, favouring a slightly wide grid — screens are portrait, so
 * a square arrangement of them is taller than a screen's worth of scrolling.
 */
export function columnCount(count: number, requested: number): number {
    if (requested > 0) {
        return requested;
    }
    return Math.min(count, Math.max(1, Math.round(Math.sqrt(count * 1.6))));
}

export function composeSheet(tiles: readonly Bitmap[], requestedColumns: number): Sheet {
    if (tiles.length === 0) {
        throw new Error("no tiles to compose");
    }
    const columns = columnCount(tiles.length, requestedColumns);
    const rows = Math.ceil(tiles.length / columns);
    const cellWidth = Math.max(...tiles.map(tile => tile.width));
    const cellHeight = Math.max(...tiles.map(tile => tile.height));

    const width = columns * cellWidth + GAP * (columns + 1);
    const height = rows * cellHeight + GAP * (rows + 1);

    // One allocation for the whole sheet: each scanline is a filter byte followed by
    // `width` RGB triplets, which is exactly what the IDAT chunk wants.
    const stride = width * 3 + 1;
    const raw = Buffer.alloc(height * stride, BG);
    for (let y = 0; y < height; y += 1) {
        raw[y * stride] = 0;
    }

    for (const [index, tile] of tiles.entries()) {
        const left = GAP + (index % columns) * (cellWidth + GAP);
        const top = GAP + Math.floor(index / columns) * (cellHeight + GAP);
        for (const [y, row] of tile.rows.entries()) {
            row.copy(raw, (top + y) * stride + 1 + left * 3);
        }
    }

    return { width, height, columns, rows, raw };
}

function chunk(tag: string, payload: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(tag, "latin1"), payload]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([header, body, checksum]);
}

/** A truecolour, 8-bit-per-channel PNG — the only kind this script ever writes. */
export function encodePng(width: number, height: number, raw: Buffer): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 6 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/** `find "$PROJECT/.shots" -name '*.png' | sort` */
export function shotsIn(directory: string): string[] {
    const found: string[] = [];
    const walk = (current: string): void => {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".png")) {
                found.push(full);
            }
        }
    };
    walk(directory);
    return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function integerOption(value: string | undefined, fallback: number, flag: string): number {
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        die(64, `error: ${flag} must be an integer`);
    }
    return parsed;
}

function main(): void {
    const args = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: true });
    } catch (error) {
        rejectArgs(error, args, OPTIONS, true);
    }

    const out = parsed.values.out;
    const project = parsed.values.project;
    const columns = integerOption(parsed.values.columns, 0, "--columns");
    const cellWidth = integerOption(
        parsed.values["cell-width"],
        DEFAULT_CELL_WIDTH,
        "--cell-width",
    );

    if (out === undefined) {
        die(64, "error: --out is required");
    }

    let files = parsed.positionals;
    if (project !== undefined && files.length === 0) {
        files = shotsIn(path.join(project, ".shots"));
    }
    if (files.length === 0) {
        die(64, "error: no input images");
    }

    const work = mkdtempSync(path.join(os.tmpdir(), "contact-sheet-"));
    try {
        // `sips` does the decoding and scaling; BMP is trivial to parse, which keeps this
        // script free of any image library.
        for (const [index, file] of files.entries()) {
            const padded = String(index).padStart(3, "0");
            const resized = spawnSync(
                "sips",
                [
                    "-s",
                    "format",
                    "bmp",
                    "--resampleWidth",
                    String(cellWidth),
                    file,
                    "--out",
                    path.join(work, `${padded}.bmp`),
                ],
                { stdio: "ignore" },
            );
            if (resized.status !== 0) {
                // The shell version ran under `set -e`, so an unreadable input stopped the
                // run with sips' own status and no message. Same here.
                throw new ExitError(resized.status ?? 1);
            }
            console.log(`${index}  ${path.basename(file)}`);
        }

        const tiles: Bitmap[] = [];
        for (const name of readdirSync(work)
            .filter(entry => entry.endsWith(".bmp"))
            .sort()) {
            const file = path.join(work, name);
            try {
                tiles.push(parseBmp(readFileSync(file), file));
            } catch (error) {
                die(1, error instanceof Error ? error.message : String(error));
            }
        }
        if (tiles.length === 0) {
            die(1, "no tiles to compose");
        }

        const sheet = composeSheet(tiles, columns);
        writeFileSync(out, encodePng(sheet.width, sheet.height, sheet.raw));
        console.log(
            `wrote ${out} (${sheet.width}x${sheet.height}, ${tiles.length} tiles, ${sheet.columns} columns)`,
        );
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runMain(main);
}
