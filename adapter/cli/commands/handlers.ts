import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import type { CommandHandler } from "../execute.ts";

import { modelsGet, modelsList } from "./models.ts";
import { settingsGet } from "./settings-get.ts";
import { settingsUpdate } from "./settings-update.ts";

export type HandledCommand = "models list" | "models get" | "settings get" | "settings update";

export type CommandHandlers = Record<HandledCommand, CommandHandler>;

/** The catalog a command reads: Pico's model registry over the user's credential store. */
export interface OpenedCatalog {
    registry: ModelRegistry;
    /** Where the credentials behind the catalog live, reported as the result's context. */
    credentialStore: string;
}

export interface HandlerContext {
    dataDir: string;
    openCatalog(): Promise<OpenedCatalog>;
}

/** The commands that need Oh My Pi, bound to one data directory and catalog. */
export function createCommandHandlers(context: HandlerContext): CommandHandlers {
    return {
        "models list": modelsList(context),
        "models get": modelsGet(context),
        "settings get": settingsGet(context),
        "settings update": settingsUpdate(context),
    };
}
