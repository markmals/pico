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
