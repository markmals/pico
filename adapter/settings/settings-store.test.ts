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
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { revisionOf, serializeSettings } from "./settings-document.ts";
import {
    readProviderBindings,
    readSettings,
    settingsFilePath,
    SettingsIoError,
    SettingsUnusableError,
    writeSettings,
} from "./settings-store.ts";

const SONNET = {
    defaultModel: "anthropic/claude-sonnet-5-5",
    defaultThinking: "high",
    autoBackground: null,
    providerCredentials: {},
};
const HAIKU = {
    defaultModel: "anthropic/claude-haiku-5",
    defaultThinking: "low",
    autoBackground: null,
    providerCredentials: {},
};

/** A revision no settings file has: 64 hexadecimal zeroes are not a document's digest. */
const STALE_REVISION = `sha256:${"0".repeat(64)}`;

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
        expect(readdirSync(dataDir).filter(name => name.endsWith(".tmp"))).toEqual([]);
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
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                providerCredentials: {},
            },
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
            expect(readdirSync(dataDir).filter(name => name.endsWith(".tmp"))).toEqual([]);
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

describe("proposal.0009 saving provider bindings", () => {
    const BOUND = {
        defaultModel: "anthropic/claude-sonnet-5-5",
        defaultThinking: "high",
        autoBackground: null,
        providerCredentials: {
            anthropic: "6f1c5f2e-0000-4000-8000-000000000001",
            "openai-codex": "6f1c5f2e-0000-4000-8000-000000000002",
        },
    };

    test("a saved binding reads back with the saved default it was written beside", () => {
        const dataDir = temporaryDataDir();

        const { revision } = writeSettings(dataDir, BOUND);

        expect(readSettings(dataDir)).toEqual({ status: "valid", revision, item: BOUND });
    });

    test("a save that drops a binding leaves the others bound", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, BOUND);

        writeSettings(dataDir, {
            ...BOUND,
            providerCredentials: { anthropic: BOUND.providerCredentials.anthropic },
        });

        const state = readSettings(dataDir);
        expect("item" in state && state.item.providerCredentials).toEqual({
            anthropic: "6f1c5f2e-0000-4000-8000-000000000001",
        });
    });

    test("a version 1 file reads as unbound, and reading it does not rewrite its bytes", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });
        const version1 = '{\n    "version": 1,\n    "autoBackground": false\n}\n';
        writeFileSync(settingsFilePath(dataDir), version1);

        const first = readSettings(dataDir);
        const second = readSettings(dataDir);

        expect(first).toEqual(second);
        expect("item" in first && first.item).toEqual({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: false,
            providerCredentials: {},
        });
        expect(readFileSync(settingsFilePath(dataDir)).toString("utf8")).toBe(version1);
    });

    test("saving over a version 1 file writes the canonical document, keeping its other settings", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(
            settingsFilePath(dataDir),
            '{\n    "version": 1,\n    "autoBackground": false\n}\n',
        );
        const read = readSettings(dataDir);
        const item = "item" in read ? read.item : undefined;

        writeSettings(dataDir, {
            ...item!,
            providerCredentials: { anthropic: "6f1c5f2e-0000-4000-8000-000000000001" },
        });

        expect(readFileSync(settingsFilePath(dataDir)).toString("utf8")).toBe(
            [
                "{",
                '    "version": 2,',
                '    "autoBackground": false,',
                '    "providerCredentials": {',
                '        "anthropic": "6f1c5f2e-0000-4000-8000-000000000001"',
                "    }",
                "}",
                "",
            ].join("\n"),
        );
    });
});

describe("proposal.0009 guarding a save with a revision", () => {
    test("a save guarded by the file's current revision is written", () => {
        const dataDir = temporaryDataDir();
        const { revision } = writeSettings(dataDir, SONNET);

        writeSettings(dataDir, HAIKU, { ifRevision: revision });

        expect(readFileSync(settingsFilePath(dataDir)).toString("utf8")).toBe(
            serializeSettings(HAIKU),
        );
    });

    test("a save guarded by a stale revision is refused, leaving the file byte for byte", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, SONNET);
        const before = readFileSync(settingsFilePath(dataDir));

        const error = thrownBy(() => writeSettings(dataDir, HAIKU, { ifRevision: STALE_REVISION }));

        expect(error).toBeDefined();
        expect(readFileSync(settingsFilePath(dataDir)).equals(before)).toBe(true);
    });

    test("the revision a save is guarded by is the file's, not the one its caller last read", () => {
        const dataDir = temporaryDataDir();
        const { revision } = writeSettings(dataDir, SONNET);
        // Another writer saves between the caller's read and its own guarded save.
        writeSettings(dataDir, HAIKU);
        const written = readFileSync(settingsFilePath(dataDir));

        const error = thrownBy(() =>
            writeSettings(
                dataDir,
                { ...SONNET, providerCredentials: { anthropic: "ref-a" } },
                { ifRevision: revision },
            ),
        );

        expect(error).toBeDefined();
        expect(readFileSync(settingsFilePath(dataDir)).equals(written)).toBe(true);
    });

    test("a first save guarded by no revision is written", () => {
        const dataDir = temporaryDataDir();

        writeSettings(dataDir, SONNET, { ifRevision: "none" });

        expect(readFileSync(settingsFilePath(dataDir)).toString("utf8")).toBe(
            serializeSettings(SONNET),
        );
    });

    test("a save guarded by no revision is refused when a settings file already exists", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, SONNET);
        const before = readFileSync(settingsFilePath(dataDir));

        const error = thrownBy(() => writeSettings(dataDir, HAIKU, { ifRevision: "none" }));

        expect(error).toBeDefined();
        expect(readFileSync(settingsFilePath(dataDir)).equals(before)).toBe(true);
    });

    test("an unguarded save still writes over whatever the file holds", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, SONNET);

        writeSettings(dataDir, HAIKU);

        expect(readFileSync(settingsFilePath(dataDir)).toString("utf8")).toBe(
            serializeSettings(HAIKU),
        );
    });
});

describe("proposal.0009 reading provider bindings", () => {
    function writeDocument(dataDir: string, text: string): void {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(settingsFilePath(dataDir), text);
    }

    test("settings that were never saved bind nothing", () => {
        expect(readProviderBindings(temporaryDataDir())).toEqual({});
    });

    test("a version 1 file binds nothing, because version 1 cannot name a credential", () => {
        const dataDir = temporaryDataDir();
        writeDocument(dataDir, '{\n    "version": 1,\n    "autoBackground": true\n}\n');

        expect(readProviderBindings(dataDir)).toEqual({});
    });

    test("a version 2 file binds each provider to the reference it names", () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, {
            ...SONNET,
            providerCredentials: { anthropic: "ref-a", "openai-codex": "ref-b" },
        });

        expect(readProviderBindings(dataDir)).toEqual({
            anthropic: "ref-a",
            "openai-codex": "ref-b",
        });
    });

    test("an invalid settings file refuses to resolve bindings instead of binding nothing", () => {
        const dataDir = temporaryDataDir();
        writeDocument(dataDir, '{"version":2,"providerCredentials":{"anthropic":7}}');

        const error = thrownBy(() => readProviderBindings(dataDir));

        expect(error).toBeInstanceOf(SettingsUnusableError);
        expect((error as SettingsUnusableError).path).toBe(settingsFilePath(dataDir));
        expect((error as SettingsUnusableError).problem).toStartWith(
            "$.providerCredentials.anthropic: ",
        );
        expect((error as SettingsUnusableError).message).toContain(settingsFilePath(dataDir));
    });

    test("a settings file a newer Pico wrote refuses to resolve bindings", () => {
        const dataDir = temporaryDataDir();
        writeDocument(dataDir, '{"version":3,"providerCredentials":{"anthropic":"ref-a"}}');

        const error = thrownBy(() => readProviderBindings(dataDir));

        expect(error).toBeInstanceOf(SettingsUnusableError);
        expect((error as SettingsUnusableError).problem).toContain("newer version of Pico");
    });

    test("a settings file that cannot be read refuses to resolve bindings", () => {
        const dataDir = temporaryDataDir();
        mkdirSync(settingsFilePath(dataDir), { recursive: true });

        expect(thrownBy(() => readProviderBindings(dataDir))).toBeInstanceOf(SettingsIoError);
    });
});
