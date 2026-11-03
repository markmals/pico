import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import type { PicoSettings, SettingsState } from "../../settings/settings-document.ts";

import {
    builtInChoice,
    findCatalogModel,
    modelValue,
    offersThinking,
} from "../../engine/model-catalog.ts";
import { DEFAULT_AUTO_BACKGROUND } from "../../settings/settings-document.ts";
import { readSettings, SettingsIoError } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";

export interface EffectiveSettings {
    defaultModel: string | null;
    defaultThinking: string | null;
    source: "settings" | "built-in";
    available: boolean;
    autoBackground: boolean;
}

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

/** What a new session would attach with now, as `session/new` resolves it. */
export async function effectiveSettings(
    registry: ModelRegistry,
    item: PicoSettings,
): Promise<EffectiveSettings> {
    const { defaultModel, defaultThinking } = item;
    const autoBackground = item.autoBackground ?? DEFAULT_AUTO_BACKGROUND;
    if (defaultModel !== null && defaultThinking !== null) {
        const model = await findCatalogModel(registry, defaultModel);
        const available = model !== undefined && offersThinking(model, defaultThinking);
        return { defaultModel, defaultThinking, source: "settings", available, autoBackground };
    }
    const choice = await builtInChoice(registry);
    return {
        defaultModel: choice ? modelValue(choice.model) : null,
        defaultThinking: choice?.thinking ?? null,
        source: "built-in",
        available: choice !== undefined,
        autoBackground,
    };
}
