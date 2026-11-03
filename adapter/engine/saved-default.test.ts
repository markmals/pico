import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { PicoSessionError } from "./errors.ts";
import { savedDefaultForNewSession } from "./saved-default.ts";

function dataDir(): string {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-saved-default-")));
    return directory;
}

function failure(directory: string): PicoSessionError {
    try {
        savedDefaultForNewSession(directory);
    } catch (error) {
        if (error instanceof PicoSessionError) return error;
        throw error;
    }
    throw new Error("the settings file was accepted");
}

describe("proposal.0007 the default a new session starts on", () => {
    test("no settings file means no saved default", () => {
        const directory = dataDir();
        try {
            expect(savedDefaultForNewSession(directory)).toBeUndefined();
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a valid file without a default means no saved default", () => {
        const directory = dataDir();
        try {
            writeFileSync(settingsFilePath(directory), '{ "version": 1 }\n');
            expect(savedDefaultForNewSession(directory)).toBeUndefined();
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a saved default is read afresh for every new session", () => {
        const directory = dataDir();
        try {
            writeSettings(directory, { defaultModel: "a/one", defaultThinking: "low" });
            expect(savedDefaultForNewSession(directory)).toEqual({
                defaultModel: "a/one",
                defaultThinking: "low",
            });
            writeSettings(directory, { defaultModel: "b/two", defaultThinking: "off" });
            expect(savedDefaultForNewSession(directory)).toEqual({
                defaultModel: "b/two",
                defaultThinking: "off",
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("an invalid file fails the session with its path and problem", () => {
        const directory = dataDir();
        try {
            writeFileSync(settingsFilePath(directory), '{ "version": 1, "defaultModel": "a/one" }');
            const error = failure(directory);
            expect(error.message).toContain(settingsFilePath(directory));
            expect(error.message).toContain("defaultThinking");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a file from a newer Pico fails the session with its path and problem", () => {
        const directory = dataDir();
        try {
            writeFileSync(settingsFilePath(directory), '{ "version": 2 }');
            const error = failure(directory);
            expect(error.message).toContain(settingsFilePath(directory));
            expect(error.message).toMatch(/newer/);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
