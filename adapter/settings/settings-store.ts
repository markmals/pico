import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PicoSettings, SettingsState } from "./settings-document.ts";

import { writeAtomically } from "../atomic-write.ts";
import { withCredentialLock } from "../credentials/coordination.ts";
import {
    readSettingsState,
    revisionOf,
    serializeSettings,
    SETTINGS_FILENAME,
} from "./settings-document.ts";

export function settingsFilePath(dataDir: string): string {
    return join(dataDir, SETTINGS_FILENAME);
}

/** The settings file could not be read or written: what `pico` reports as `IO_ERROR`. */
export class SettingsIoError extends Error {
    readonly path: string;
    override readonly cause: string;

    constructor(path: string, cause: unknown) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(`cannot use ${path}: ${reason}`);
        this.name = "SettingsIoError";
        this.path = path;
        this.cause = reason;
    }
}

/**
 * A guarded save found a settings file at another revision: what `pico` reports as `CONFLICT`.
 * The file keeps the bytes the other writer left (proposal.0009).
 */
export class SettingsConflictError extends Error {
    readonly path: string;
    readonly expected: string;
    readonly actual: string;

    constructor(path: string, expected: string, actual: string) {
        super(`${path} is at revision ${actual}, not the expected ${expected}`);
        this.name = "SettingsConflictError";
        this.path = path;
        this.expected = expected;
        this.actual = actual;
    }
}

/**
 * The settings file cannot be used, so nothing it configures can be resolved from it: what
 * `pico` reports as `FAILED_PRECONDITION` (proposal.0009).
 */
export class SettingsUnusableError extends Error {
    readonly path: string;
    readonly problem: string;

    constructor(path: string, problem: string) {
        super(`${path} cannot be used: ${problem}`);
        this.name = "SettingsUnusableError";
        this.path = path;
        this.problem = problem;
    }
}

export function readSettings(dataDir: string): SettingsState {
    return readSettingsState(readBytes(settingsFilePath(dataDir)));
}

/**
 * The credential reference bound to each model provider, empty when none is bound. A settings
 * file Pico cannot use never resolves to a last-known binding: it fails instead (proposal.0009).
 */
export function readProviderBindings(dataDir: string): Record<string, string> {
    const state = readSettings(dataDir);
    if ("problem" in state) {
        throw new SettingsUnusableError(settingsFilePath(dataDir), state.problem);
    }
    return state.item.providerCredentials;
}

/**
 * Saves `item` whole, leaving the previous file untouched when anything fails. `ifRevision` is
 * compared with the file itself inside the lock that serializes credential mutations, so a save
 * never overwrites a revision its caller did not read (proposal.0009).
 */
export function writeSettings(
    dataDir: string,
    item: PicoSettings,
    options: { ifRevision?: string } = {},
): { revision: string } {
    const bytes = new TextEncoder().encode(serializeSettings(item));
    const path = settingsFilePath(dataDir);
    const { ifRevision } = options;
    return locked(path, dataDir, () => {
        if (ifRevision !== undefined) {
            const actual = revisionOf(readBytes(path));
            if (actual !== ifRevision) throw new SettingsConflictError(path, ifRevision, actual);
        }
        try {
            const created = mkdirSync(dataDir, { recursive: true });
            // `mkdirSync`'s mode is filtered by the umask; a directory Pico creates must end up 0700.
            if (created !== undefined) chmodSync(dataDir, 0o700);
            writeAtomically(path, bytes, 0o600);
        } catch (error) {
            throw new SettingsIoError(path, error);
        }
        return { revision: revisionOf(bytes) };
    });
}

/**
 * Runs the save holding the credential lock, so a binding selection cannot interleave with a
 * credential deletion. A lock Pico cannot take leaves the file unwritten, which is the same
 * failure to a caller as a file it cannot write.
 */
function locked<T>(path: string, dataDir: string, action: () => T): T {
    try {
        return withCredentialLock(dataDir, action);
    } catch (error) {
        if (error instanceof SettingsIoError || error instanceof SettingsConflictError) throw error;
        throw new SettingsIoError(path, error);
    }
}

function readBytes(path: string): Uint8Array | undefined {
    try {
        return readFileSync(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw new SettingsIoError(path, error);
    }
}
