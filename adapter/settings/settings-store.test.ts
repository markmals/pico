import { afterEach, describe, expect, test } from "bun:test";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { revisionOf, serializeSettings } from "./settings-document.ts";
import {
    readSettings,
    settingsFilePath,
    SettingsIoError,
    writeSettings,
} from "./settings-store.ts";

const SONNET = {
    defaultModel: "anthropic/claude-sonnet-5-5",
    defaultThinking: "high",
    autoBackground: null,
};
const HAIKU = {
    defaultModel: "anthropic/claude-haiku-5",
    defaultThinking: "low",
    autoBackground: null,
};

/** A save cannot finish only because the directory refuses it, which root is never told. */
const AS_ROOT = process.getuid?.() === 0;

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-settings-")));
    roots.push(root);
    return join(root, "Pico");
}

function thrownBy(action: () => void): unknown {
    try {
        action();
        return undefined;
    } catch (error) {
        return error;
    }
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0007 saving settings", () => {
    test("the settings file sits in the data directory", () => {
        expect(settingsFilePath("/tmp/Pico")).toBe("/tmp/Pico/settings.json");
    });

    test("a save creates a missing data directory, readable only by its owner", () => {
        const dataDir = temporaryDataDir();

        writeSettings(dataDir, SONNET);

        expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    });

    test("a save writes the serialized document and returns its revision, leaving no temporary file", () => {
        const dataDir = temporaryDataDir();

        const { revision } = writeSettings(dataDir, SONNET);

        const written = readFileSync(settingsFilePath(dataDir));
        expect(written.toString("utf8")).toBe(serializeSettings(SONNET));
        expect(revision).toBe(revisionOf(written));
        expect(readdirSync(dataDir)).toEqual(["settings.json"]);
    });

    test("a saved default reads back as valid settings at the revision the save returned", () => {
        const dataDir = temporaryDataDir();

        const { revision } = writeSettings(dataDir, SONNET);

        expect(readSettings(dataDir)).toEqual({ status: "valid", revision, item: SONNET });
    });

    test("settings that were never saved are missing", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });

        expect(readSettings(dataDir)).toEqual({
            status: "missing",
            revision: "none",
            item: { defaultModel: null, defaultThinking: null, autoBackground: null },
        });
    });

    test.skipIf(AS_ROOT)("a save that cannot finish leaves the previous file byte for byte", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, SONNET);
        const before = readFileSync(settingsFilePath(dataDir));
        chmodSync(dataDir, 0o500);

        try {
            const error = thrownBy(() => writeSettings(dataDir, HAIKU));

            expect(error).toBeInstanceOf(SettingsIoError);
            expect((error as SettingsIoError).path).toBe(settingsFilePath(dataDir));
            expect((error as SettingsIoError).cause).toBeTypeOf("string");
            expect((error as SettingsIoError).message).toContain(settingsFilePath(dataDir));
            expect(readFileSync(settingsFilePath(dataDir)).equals(before)).toBe(true);
            expect(readdirSync(dataDir)).toEqual(["settings.json"]);
        } finally {
            chmodSync(dataDir, 0o700);
        }
    });

    test.skipIf(AS_ROOT)("a first save that cannot finish writes nothing at all", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });
        chmodSync(dataDir, 0o500);

        try {
            expect(thrownBy(() => writeSettings(dataDir, SONNET))).toBeInstanceOf(SettingsIoError);
            expect(readdirSync(dataDir)).toEqual([]);
        } finally {
            chmodSync(dataDir, 0o700);
        }
    });

    test("a settings file that cannot be read is an I/O error naming it", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(settingsFilePath(dataDir), { recursive: true });

        const error = thrownBy(() => readSettings(dataDir));

        expect(error).toBeInstanceOf(SettingsIoError);
        expect((error as SettingsIoError).path).toBe(settingsFilePath(dataDir));
        expect((error as SettingsIoError).message).toContain(settingsFilePath(dataDir));
    });
});
