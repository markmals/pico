import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import type { PicoSettings } from "../../settings/settings-document.ts";
import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import {
    builtInChoice,
    findCatalogModel,
    modelValue,
    offersThinking,
} from "../../engine/model-catalog.ts";
import { DEFAULT_AUTO_BACKGROUND } from "../../settings/settings-document.ts";
import { settingsFilePath } from "../../settings/settings-store.ts";
import { readSettingsFile } from "./settings-file.ts";

export interface EffectiveSettings {
    defaultModel: string | null;
    defaultThinking: string | null;
    source: "settings" | "built-in";
    available: boolean;
    autoBackground: boolean;
}

export function settingsGet(context: HandlerContext): CommandHandler {
    return async () => {
        const settingsFile = settingsFilePath(context.dataDir);
        const state = readSettingsFile(context.dataDir);
        if ("problem" in state) {
            const { status, revision, problem } = state;
            return { settingsFile, status, revision, item: null, effective: null, problem };
        }
        const { registry } = await context.openCatalog();
        return {
            settingsFile,
            status: state.status,
            revision: state.revision,
            item: state.item,
            effective: await effectiveSettings(registry, state.item),
        };
    };
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
