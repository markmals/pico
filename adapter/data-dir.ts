import { chmodSync, closeSync, mkdirSync, openSync, statSync } from "node:fs";
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
 * Creates `path` empty when it is missing and proves it can be written, so a file Pico needs
 * later, such as the model cache Oh My Pi opens lazily, fails the start instead of the session.
 */
export function ensureDataFile(path: string): void {
    try {
        closeSync(openSync(path, "a"));
    } catch (error) {
        throw new DataDirError(path, error);
    }
}
