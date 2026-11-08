import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { settingsFilePath, writeSettings } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { picoCatalog } from "./catalog.ts";

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-catalog-")));
    roots.push(root);
    return path.join(root, "Pico");
}

async function failure(open: () => Promise<unknown>): Promise<CliError> {
    try {
        await open();
    } catch (error) {
        if (error instanceof CliError) return error;
        throw error;
    }
    throw new Error("the catalog opened");
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 the catalog commands read", () => {
    test("a data directory that binds nothing opens a catalog with no selected credential", async () => {
        const dataDir = temporaryDataDir();

        const catalog = await picoCatalog(dataDir)();

        expect(catalog.providerCredentials).toEqual({});
        expect(catalog.registry).toBeDefined();
    });

    test("the catalog reports the bindings the settings file names, and no store path", async () => {
        const dataDir = temporaryDataDir();
        writeSettings(dataDir, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: { anthropic: "6f1c5f2e-0000-4000-8000-000000000001" },
        });

        const catalog = await picoCatalog(dataDir)();

        expect(catalog.providerCredentials).toEqual({
            anthropic: "6f1c5f2e-0000-4000-8000-000000000001",
        });
        expect(Object.keys(catalog)).toEqual(["registry", "providerCredentials"]);
    });

    test("an unusable settings file is a precondition naming the file and its problem", async () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(settingsFilePath(dataDir), '{"version":2,"providerCredentials":{"a":7}}');

        const error = await failure(picoCatalog(dataDir));

        expect(error.code).toBe("FAILED_PRECONDITION");
        expect(error.details.settingsFile).toBe(settingsFilePath(dataDir));
        expect(error.message).toContain(settingsFilePath(dataDir));
        expect(error.message).toContain("$.providerCredentials.a");
    });

    test("a settings file a newer Pico wrote is refused rather than read as unbound", async () => {
        const dataDir = temporaryDataDir();
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(settingsFilePath(dataDir), '{"version":4}');

        const error = await failure(picoCatalog(dataDir));

        expect(error.code).toBe("FAILED_PRECONDITION");
        expect(error.message).toContain("newer version of Pico");
    });
});
