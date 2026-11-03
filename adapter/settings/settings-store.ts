import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PicoSettings, SettingsState } from "./settings-document.ts";

import { writeAtomically } from "../atomic-write.ts";
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

export function readSettings(dataDir: string): SettingsState {
    return readSettingsState(readBytes(settingsFilePath(dataDir)));
}

/** Saves `item` whole, leaving the previous file untouched when anything fails. */
export function writeSettings(dataDir: string, item: PicoSettings): { revision: string } {
    const bytes = new TextEncoder().encode(serializeSettings(item));
    const path = settingsFilePath(dataDir);
    try {
        const created = mkdirSync(dataDir, { recursive: true });
        // `mkdirSync`'s mode is filtered by the umask; a directory Pico creates must end up 0700.
        if (created !== undefined) chmodSync(dataDir, 0o700);
        writeAtomically(path, bytes, 0o600);
    } catch (error) {
        throw new SettingsIoError(path, error);
    }
    return { revision: revisionOf(bytes) };
}

function readBytes(path: string): Uint8Array | undefined {
    try {
        return readFileSync(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw new SettingsIoError(path, error);
    }
}
