import { afterEach, describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installNativeAddon } from "./native-addon.ts";

const FILENAME = "pi_natives.darwin-arm64.node";
const VERSION = "18.14.0";

const roots: string[] = [];

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-native-addon-")));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A stand-in for the embedded addon: Pico only copies and compares its bytes. */
function embeddedAddon(root: string, content = "embedded addon bytes"): string {
    const source = join(root, "embedded", FILENAME);
    mkdirSync(join(root, "embedded"), { recursive: true });
    writeFileSync(source, content);
    return source;
}

describe("proposal.0002 extracting the native addon", () => {
    test("a missing addon is written to <natives>/<version>/<file>", () => {
        const root = temporaryRoot();
        const source = embeddedAddon(root);
        const nativesDir = join(root, "natives");

        const installed = installNativeAddon({
            source,
            nativesDir,
            version: VERSION,
            filename: FILENAME,
        });

        expect(installed).toBe(join(nativesDir, VERSION, FILENAME));
        expect(readFileSync(installed, "utf8")).toBe("embedded addon bytes");
    });

    test("an extracted addon whose bytes differ, even at the same size, is rewritten", () => {
        const root = temporaryRoot();
        const source = embeddedAddon(root, "embedded addon bytes");
        const nativesDir = join(root, "natives");
        mkdirSync(join(nativesDir, VERSION), { recursive: true });
        writeFileSync(join(nativesDir, VERSION, FILENAME), "tampered addon bytes");

        const installed = installNativeAddon({
            source,
            nativesDir,
            version: VERSION,
            filename: FILENAME,
        });

        expect(readFileSync(installed, "utf8")).toBe("embedded addon bytes");
    });

    test("an extracted addon that matches is left in place", () => {
        const root = temporaryRoot();
        const source = embeddedAddon(root);
        const nativesDir = join(root, "natives");
        const target = join(nativesDir, VERSION, FILENAME);
        mkdirSync(join(nativesDir, VERSION), { recursive: true });
        writeFileSync(target, "embedded addon bytes");
        const past = new Date("2026-01-01T00:00:00Z");
        utimesSync(target, past, past);

        installNativeAddon({ source, nativesDir, version: VERSION, filename: FILENAME });

        expect(statSync(target).mtime.getTime()).toBe(past.getTime());
    });

    test("other versions' directories are removed and no temporary file is left behind", () => {
        const root = temporaryRoot();
        const source = embeddedAddon(root);
        const nativesDir = join(root, "natives");
        mkdirSync(join(nativesDir, "18.13.0"), { recursive: true });
        writeFileSync(join(nativesDir, "18.13.0", FILENAME), "old addon");
        mkdirSync(join(nativesDir, "19.0.0"), { recursive: true });

        installNativeAddon({ source, nativesDir, version: VERSION, filename: FILENAME });

        expect(readdirSync(nativesDir)).toEqual([VERSION]);
        expect(readdirSync(join(nativesDir, VERSION))).toEqual([FILENAME]);
    });

    test("extraction does not depend on a writable temporary directory", () => {
        const root = temporaryRoot();
        const source = embeddedAddon(root);
        const nativesDir = join(root, "natives");
        const previous = process.env.TMPDIR;
        process.env.TMPDIR = join(root, "missing-tmp");
        try {
            const installed = installNativeAddon({
                source,
                nativesDir,
                version: VERSION,
                filename: FILENAME,
            });

            expect(existsSync(installed)).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = previous;
        }
    });
});
