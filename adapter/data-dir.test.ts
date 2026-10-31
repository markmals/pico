import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataDirError, ensureDataDir, picoDataDir } from "./data-dir.ts";

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
});
