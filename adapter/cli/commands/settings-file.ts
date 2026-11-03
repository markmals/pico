// Reading Pico's settings file, and the failures a command reports for it. Nothing here
// touches the engine: a preview must reach this module before the engine's runtime exists.

import type { SettingsState } from "../../settings/settings-document.ts";

import {
    readProviderBindings,
    readSettings,
    SettingsIoError,
    SettingsUnusableError,
} from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";

/** The settings file's state, with a read failure reported as `IO_ERROR`. */
export function readSettingsFile(dataDir: string): SettingsState {
    try {
        return readSettings(dataDir);
    } catch (error) {
        throw ioError(error);
    }
}

export function ioError(error: unknown): unknown {
    if (!(error instanceof SettingsIoError)) return error;
    return new CliError("IO_ERROR", `Pico ${error.message}`, {
        details: { path: error.path, cause: error.cause },
    });
}

/** The provider bindings the settings file holds, with an unusable file refused visibly. */
export function readBindings(dataDir: string): Record<string, string> {
    try {
        return readProviderBindings(dataDir);
    } catch (error) {
        throw settingsUnusable(error);
    }
}

/**
 * A settings file Pico cannot read is a precondition failure, not an empty configuration: it
 * must never let a command fall back to a last-known binding.
 */
export function settingsUnusable(error: unknown): unknown {
    if (error instanceof SettingsUnusableError) {
        return new CliError(
            "FAILED_PRECONDITION",
            `Pico's settings file ${error.path} cannot be used: ${error.problem}. Fix or remove it first.`,
            { details: { settingsFile: error.path, problem: error.problem } },
        );
    }
    return ioError(error);
}
