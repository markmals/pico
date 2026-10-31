import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** A file or directory in Pico's data directory that Pico cannot create or write. */
export class DataDirError extends Error {
    constructor(path: string, cause: unknown) {
        super(`cannot use ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, {
            cause,
        });
        this.name = "DataDirError";
    }
}

export function picoDataDir(home: string): string {
    return join(home, "Library", "Application Support", "Pico");
}

/** Creates the data directory, readable only by its owner, when it is missing. */
export function ensureDataDir(dataDir: string): void {
    if (isDirectory(dataDir)) return;
    try {
        mkdirSync(dataDir, { recursive: true });
        // `mkdirSync`'s mode is filtered by the umask; the directory must end up 0700.
        chmodSync(dataDir, 0o700);
    } catch (error) {
        throw new DataDirError(dataDir, error);
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Proves Pico can write the SQLite database at `path`, creating it when missing. Oh My Pi opens
 * the model cache only once a session starts, in WAL mode, and carries on silently when it
 * cannot write it, so a cache that would fail must fail the start instead. A real write is
 * the only test that covers the log files SQLite adds beside the database.
 */
export function ensureWritableDatabase(path: string): void {
    let database: Database | undefined;
    try {
        database = new Database(path, { create: true, readwrite: true });
        database.run("PRAGMA journal_mode = WAL");
        const header = database.query("PRAGMA user_version").get() as { user_version: number };
        database.run(`PRAGMA user_version = ${header.user_version}`);
    } catch (error) {
        throw new DataDirError(path, error);
    } finally {
        database?.close();
    }
}
