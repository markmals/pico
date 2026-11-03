import type { SettingsState } from "../settings/settings-document.ts";
import type { SavedDefault } from "./pico-session.ts";

import { readSettings, SettingsIoError, settingsFilePath } from "../settings/settings-store.ts";
import { PicoSessionError } from "./errors.ts";

/**
 * Pico's saved default, read afresh for each `session/new` so a save applies to the next session
 * without restarting `pico`. A file Pico cannot use fails the session instead of being ignored.
 */
export function savedDefaultForNewSession(dataDir: string): SavedDefault | undefined {
    const state = readState(dataDir);
    switch (state.status) {
        case "missing":
            return undefined;
        case "valid": {
            const { defaultModel, defaultThinking } = state.item;
            if (defaultModel === null || defaultThinking === null) return undefined;
            return { defaultModel, defaultThinking };
        }
        default:
            throw new PicoSessionError(
                `Pico's settings file ${settingsFilePath(dataDir)} cannot be used: ${state.problem}. ` +
                    "Fix or remove it, then start a new session.",
            );
    }
}

function readState(dataDir: string): SettingsState {
    try {
        return readSettings(dataDir);
    } catch (error) {
        if (error instanceof SettingsIoError) throw new PicoSessionError(`Pico ${error.message}`);
        throw error;
    }
}
