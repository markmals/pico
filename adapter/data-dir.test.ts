import { afterEach, describe, expect, test } from "bun:test";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataDirError, ensureDataDir, ensureDataFile, picoDataDir } from "./data-dir.ts";

const roots: string[] = [];

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-data-dir-")));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        chmodSync(root, 0o755);
        rmSync(root, { recursive: true, force: true });
    }
});

describe("proposal.0002 Pico's data directory", () => {
    test("lives in Application Support under the home directory", () => {
        expect(picoDataDir("/Users/someone")).toBe(
            "/Users/someone/Library/Application Support/Pico",
        );
    });

    test("is created with mode 0700 when missing", () => {
        const dataDir = join(temporaryRoot(), "Library", "Application Support", "Pico");

        ensureDataDir(dataDir);

        expect(statSync(dataDir).isDirectory()).toBe(true);
        expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    });

    test("an existing directory keeps its mode", () => {
        const dataDir = join(temporaryRoot(), "Pico");
        mkdirSync(dataDir, { mode: 0o755 });
        chmodSync(dataDir, 0o755);

        ensureDataDir(dataDir);

        expect(statSync(dataDir).mode & 0o777).toBe(0o755);
    });

    test("a directory that cannot be created is reported with its path and cause", () => {
        const root = temporaryRoot();
        chmodSync(root, 0o555);
        const dataDir = join(root, "Pico");

        let failure: unknown;
        try {
            ensureDataDir(dataDir);
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(DataDirError);
        expect((failure as DataDirError).message).toMatch(
            new RegExp(`^cannot use ${dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .+`),
        );
    });

    test("a data file that is missing is created empty, and an existing one keeps its contents", () => {
        const root = temporaryRoot();
        const missing = join(root, "models.db");
        const existing = join(root, "kept.db");
        writeFileSync(existing, "cache");

        ensureDataFile(missing);
        ensureDataFile(existing);

        expect(readFileSync(missing, "utf8")).toBe("");
        expect(readFileSync(existing, "utf8")).toBe("cache");
    });

    test.each([
        ["a directory", (path: string) => mkdirSync(path)],
        ["a read-only file", (path: string) => writeFileSync(path, "", { mode: 0o444 })],
    ])("a data file that is %s is reported with its path and cause", (_kind, occupy) => {
        const path = join(temporaryRoot(), "models.db");
        occupy(path);

        expect(() => ensureDataFile(path)).toThrow(new RegExp(`^cannot use .*models\\.db: .+`));
        expect(() => ensureDataFile(path)).toThrow(DataDirError);
    });
});
