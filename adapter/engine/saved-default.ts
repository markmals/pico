import type { SettingsState } from "../settings/settings-document.ts";
import type { SavedDefault } from "./pico-session.ts";

import { DEFAULT_AUTO_BACKGROUND } from "../settings/settings-document.ts";
import { readSettings, SettingsIoError, settingsFilePath } from "../settings/settings-store.ts";
import { PicoSessionError } from "./errors.ts";

const FIX_THE_FILE = "Fix or remove it, then start a new session.";

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
            throw new PicoSessionError(`${unusable(dataDir, state.problem)}. ${FIX_THE_FILE}`);
    }
}

/**
 * Whether a session attaching now moves slow commands to the background, read afresh on every
 * attach (proposal.0008). A file Pico cannot use fails a new session, as it does for the saved
 * default; a reopened session never depends on the file, so it gets Pico's default and the
 * problem goes to stderr.
 */
export function autoBackgroundForSession(dataDir: string, fresh: boolean): boolean {
    let state: SettingsState;
    try {
        state = readState(dataDir);
    } catch (error) {
        if (fresh || !(error instanceof PicoSessionError)) throw error;
        return reopenedWithDefault(error.message);
    }
    if (state.status === "missing") return DEFAULT_AUTO_BACKGROUND;
    if (state.status === "valid") return state.item.autoBackground ?? DEFAULT_AUTO_BACKGROUND;
    const problem = unusable(dataDir, state.problem);
    if (fresh) throw new PicoSessionError(`${problem}. ${FIX_THE_FILE}`);
    return reopenedWithDefault(problem);
}

function reopenedWithDefault(problem: string): boolean {
    console.error(`pico: ${problem}; the reopened session uses Pico's default auto-background, on`);
    return DEFAULT_AUTO_BACKGROUND;
}

function unusable(dataDir: string, problem: string): string {
    return `Pico's settings file ${settingsFilePath(dataDir)} cannot be used: ${problem}`;
}

function readState(dataDir: string): SettingsState {
    try {
        return readSettings(dataDir);
    } catch (error) {
        if (error instanceof SettingsIoError) throw new PicoSessionError(`Pico ${error.message}`);
        throw error;
    }
}
