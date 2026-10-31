import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataDirError, ensureDataDir, ensureWritableDatabase, picoDataDir } from "./data-dir.ts";

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

    test("a model cache that is missing is created, and an existing one keeps its rows", () => {
        const root = temporaryRoot();
        const missing = join(root, "models.db");
        const existing = join(root, "kept.db");
        const seeded = new Database(existing);
        seeded.run("CREATE TABLE kept (value TEXT)");
        seeded.run("INSERT INTO kept VALUES ('row')");
        seeded.close();

        ensureWritableDatabase(missing);
        ensureWritableDatabase(existing);

        expect(statSync(missing).isFile()).toBe(true);
        const reopened = new Database(existing);
        expect(reopened.query("SELECT value FROM kept").all()).toEqual([{ value: "row" }]);
        reopened.close();
    });

    test.each([
        ["a directory", (_root: string, path: string) => mkdirSync(path)],
        [
            "a read-only file",
            (_root: string, path: string) => writeFileSync(path, "", { mode: 0o444 }),
        ],
        [
            "beside a directory where SQLite's write-ahead log goes",
            (_root: string, path: string) => mkdirSync(`${path}-wal`),
        ],
        [
            "in a folder SQLite cannot add its log files to",
            (root: string, path: string) => {
                const seeded = new Database(path);
                seeded.run("CREATE TABLE kept (value TEXT)");
                seeded.close();
                chmodSync(root, 0o500);
            },
        ],
    ])("a model cache %s is reported with its path and cause", (_kind, occupy) => {
        const root = temporaryRoot();
        const path = join(root, "models.db");
        occupy(root, path);

        let failure: unknown;
        try {
            ensureWritableDatabase(path);
        } catch (error) {
            failure = error;
        } finally {
            chmodSync(root, 0o755);
        }

        expect(failure).toBeInstanceOf(DataDirError);
        expect((failure as DataDirError).message).toMatch(/^cannot use .*models\.db: .+/);
    });
});
