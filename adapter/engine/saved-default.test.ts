import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { PicoSessionError } from "./errors.ts";
import { autoBackgroundForSession, savedDefaultForNewSession } from "./saved-default.ts";

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
            writeSettings(directory, {
                defaultModel: "a/one",
                defaultThinking: "low",
                autoBackground: null,
                providerCredentials: {},
            });
            expect(savedDefaultForNewSession(directory)).toEqual({
                defaultModel: "a/one",
                defaultThinking: "low",
            });
            writeSettings(directory, {
                defaultModel: "b/two",
                defaultThinking: "off",
                autoBackground: null,
                providerCredentials: {},
            });
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
            writeFileSync(settingsFilePath(directory), '{ "version": 3 }');
            const error = failure(directory);
            expect(error.message).toContain(settingsFilePath(directory));
            expect(error.message).toMatch(/newer/);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe("proposal.0008 the auto-background setting a session attaches with", () => {
    function withDirectory(run: (directory: string) => void): void {
        const directory = dataDir();
        try {
            run(directory);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    test("Pico's default is on, for new and reopened sessions alike", () => {
        withDirectory(directory => {
            expect(autoBackgroundForSession(directory, true)).toBe(true);
            expect(autoBackgroundForSession(directory, false)).toBe(true);
            writeFileSync(settingsFilePath(directory), '{ "version": 1 }\n');
            expect(autoBackgroundForSession(directory, true)).toBe(true);
            expect(autoBackgroundForSession(directory, false)).toBe(true);
        });
    });

    test("every attach reads the value saved at that moment", () => {
        withDirectory(directory => {
            writeFileSync(
                settingsFilePath(directory),
                '{ "version": 1, "autoBackground": false }\n',
            );
            expect(autoBackgroundForSession(directory, true)).toBe(false);
            expect(autoBackgroundForSession(directory, false)).toBe(false);
            writeFileSync(
                settingsFilePath(directory),
                '{ "version": 1, "autoBackground": true }\n',
            );
            expect(autoBackgroundForSession(directory, true)).toBe(true);
            expect(autoBackgroundForSession(directory, false)).toBe(true);
        });
    });

    test("an unusable file fails a new session with its path and problem", () => {
        withDirectory(directory => {
            writeFileSync(settingsFilePath(directory), '{ "version": 1, "autoBackground": "no" }');
            expect(() => autoBackgroundForSession(directory, true)).toThrow(
                settingsFilePath(directory),
            );
        });
    });

    test("an unusable file reopens a session with Pico's default and one line on stderr", () => {
        for (const contents of ["not json", '{ "version": 3 }', '{ "version": 1, "x": 1 }']) {
            withDirectory(directory => {
                writeFileSync(settingsFilePath(directory), contents);
                const logged = spyOn(console, "error").mockImplementation(() => {});
                try {
                    expect(autoBackgroundForSession(directory, false)).toBe(true);
                    expect(logged).toHaveBeenCalledTimes(1);
                    expect(String(logged.mock.calls[0]?.[0])).toContain(
                        settingsFilePath(directory),
                    );
                } finally {
                    logged.mockRestore();
                }
            });
        }
    });

    test("a settings file that cannot be read reopens a session with Pico's default", () => {
        withDirectory(directory => {
            mkdirSync(settingsFilePath(directory));
            const logged = spyOn(console, "error").mockImplementation(() => {});
            try {
                expect(autoBackgroundForSession(directory, false)).toBe(true);
                expect(logged).toHaveBeenCalledTimes(1);
            } finally {
                logged.mockRestore();
            }
        });
    });
});
