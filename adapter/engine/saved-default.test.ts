import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { PicoSessionError } from "./errors.ts";
import {
    autoBackgroundForSession,
    intellisenseForSession,
    savedDefaultForNewSession,
} from "./saved-default.ts";

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
                intellisensePath: null,
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
                intellisensePath: null,
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
            writeFileSync(settingsFilePath(directory), '{ "version": 4 }');
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
        for (const contents of ["not json", '{ "version": 4 }', '{ "version": 1, "x": 1 }']) {
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

describe("pico-bfk.20 the intellisense location a session attaches with", () => {
    function workspace(): { directory: string; home: string; bin: string } {
        const directory = dataDir();
        const home = path.join(directory, "home");
        const bin = path.join(directory, "bin");
        mkdirSync(home, { recursive: true });
        mkdirSync(bin, { recursive: true });
        return { directory, home, bin };
    }

    function executable(file: string): string {
        writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
        return file;
    }

    function savedPath(directory: string, intellisensePath: string | null): void {
        writeSettings(directory, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath,
            providerCredentials: {},
        });
    }

    test("with nothing saved, it discovers from the process's own environment", () => {
        const { directory, home, bin } = workspace();
        try {
            const found = executable(path.join(bin, "intellisense"));

            expect(intellisenseForSession(directory, true, { path: bin, home })).toEqual({
                status: "found",
                source: "discovered",
                path: found,
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("every attach reads the path saved at that moment", () => {
        const { directory, home, bin } = workspace();
        try {
            const first = executable(path.join(bin, "one"));
            const second = executable(path.join(bin, "two"));
            const environment = { path: bin, home };
            savedPath(directory, first);

            expect(intellisenseForSession(directory, false, environment)).toEqual({
                status: "found",
                source: "settings",
                path: first,
            });

            savedPath(directory, second);

            expect(intellisenseForSession(directory, true, environment)).toEqual({
                status: "found",
                source: "settings",
                path: second,
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a saved path that cannot be used is unusable for new and reopened sessions alike", () => {
        const { directory, home, bin } = workspace();
        try {
            executable(path.join(bin, "intellisense"));
            const gone = path.join(bin, "removed");
            savedPath(directory, gone);
            const environment = { path: bin, home };

            for (const fresh of [true, false]) {
                expect(intellisenseForSession(directory, fresh, environment)).toEqual({
                    status: "unusable",
                    source: "settings",
                    path: gone,
                    problem: `${gone} does not exist`,
                });
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("an unusable settings file fails a new session", () => {
        const { directory, home, bin } = workspace();
        try {
            writeFileSync(settingsFilePath(directory), '{ "version": 1, "autoBackground": "no" }');

            expect(() => intellisenseForSession(directory, true, { path: bin, home })).toThrow(
                settingsFilePath(directory),
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a reopened session gets an unusable location naming the settings file", () => {
        const { directory, home, bin } = workspace();
        try {
            executable(path.join(bin, "intellisense"));
            writeFileSync(settingsFilePath(directory), "not json");

            const location = intellisenseForSession(directory, false, { path: bin, home });

            expect(location.status).toBe("unusable");
            expect(location).toMatchObject({ source: "settings", path: null });
            expect("problem" in location ? location.problem : "").toStartWith(
                `Pico's settings file ${settingsFilePath(directory)} cannot be used: `,
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
