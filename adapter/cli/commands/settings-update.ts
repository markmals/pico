import type { Api, Model } from "@oh-my-pi/pi-ai";

import type { PicoSettings } from "../../settings/settings-document.ts";
import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import {
    defaultThinking,
    findCatalogModel,
    offersThinking,
    thinkingChoices,
} from "../../engine/model-catalog.ts";
import { revisionOf, serializeSettings } from "../../settings/settings-document.ts";
import {
    SettingsConflictError,
    settingsFilePath,
    writeSettings,
} from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { modelNotFound } from "./models.ts";
import { ioError, readSettingsFile } from "./settings-file.ts";

interface UpdateOptions {
    defaultModel?: string;
    defaultThinking?: string;
    autoBackground?: string;
    ifRevision?: string;
    dryRun?: boolean;
}

/**
 * Checks in the proposal's order: the file, its revision, then the catalog, which is opened only
 * when the default model or thinking level changes; only then writes, and only when the document
 * would change and this is not a dry run.
 */
export function settingsUpdate(context: HandlerContext): CommandHandler {
    return async input => {
        const options = input.options as UpdateOptions;
        const settingsFile = settingsFilePath(context.dataDir);
        const state = readSettingsFile(context.dataDir);
        if ("problem" in state) {
            throw new CliError(
                "FAILED_PRECONDITION",
                `Pico's settings file ${settingsFile} cannot be updated: ${state.problem}. Fix or remove it first.`,
                { details: { settingsFile, problem: state.problem } },
            );
        }
        // The authoritative check happens inside the write lock; this one only fails early.
        if (options.ifRevision !== undefined && options.ifRevision !== state.revision) {
            throw conflict(settingsFile, options.ifRevision, state.revision);
        }
        const after = await chosenSettings(context, state.item, options, settingsFile);
        if (options.dryRun !== true) {
            const current = readSettingsFile(context.dataDir);
            if (current.revision !== state.revision) {
                throw conflict(settingsFile, state.revision, current.revision);
            }
        }
        const before = { revision: state.revision, item: state.item };
        const revision = revisionOf(new TextEncoder().encode(serializeSettings(after)));
        if (revision === state.revision) {
            return {
                settingsFile,
                dryRun: options.dryRun === true,
                changed: false,
                before,
                after: before,
            };
        }
        if (options.dryRun !== true) save(context.dataDir, after, state.revision);
        return {
            settingsFile,
            dryRun: options.dryRun === true,
            changed: true,
            before,
            after: { revision, item: after },
        };
    };
}

/** The settings a save would hold: the saved ones with whatever the options change. */
async function chosenSettings(
    context: HandlerContext,
    saved: PicoSettings,
    options: UpdateOptions,
    settingsFile: string,
): Promise<PicoSettings> {
    const autoBackground =
        options.autoBackground === undefined
            ? saved.autoBackground
            : options.autoBackground === "on";
    if (options.defaultModel === undefined && options.defaultThinking === undefined) {
        return { ...saved, autoBackground };
    }
    const chosen = await chosenDefault(context, saved, options, settingsFile);
    // A default-model save keeps the provider selections: they are a separate decision.
    return { ...chosen, autoBackground, providerCredentials: saved.providerCredentials };
}

async function chosenDefault(
    context: HandlerContext,
    saved: PicoSettings,
    options: UpdateOptions,
    settingsFile: string,
): Promise<{ defaultModel: string; defaultThinking: string }> {
    const value = options.defaultModel ?? saved.defaultModel;
    if (value === null) {
        throw new CliError(
            "FAILED_PRECONDITION",
            "No default model is saved, so --default-thinking has no model to apply to; give --default-model too.",
            { details: { settingsFile, problem: "no default model is saved" } },
        );
    }
    const { registry } = await context.openCatalog();
    const model = await findCatalogModel(registry, value);
    if (!model) throw modelNotFound(value);
    const thinking = options.defaultThinking ?? keptThinking(model, saved.defaultThinking);
    if (!offersThinking(model, thinking)) {
        const accepted = thinkingChoices(model).map(choice => choice.value);
        throw new CliError(
            "INVALID_ARGUMENT",
            `${value} does not offer the thinking level ${thinking}; it offers ${accepted.join(", ")}.`,
            { details: { argument: "--default-thinking", accepted } },
        );
    }
    return { defaultModel: value, defaultThinking: thinking };
}

/** The saved level when the model offers it, otherwise the model's own default. */
function keptThinking(model: Model<Api>, saved: string | null): string {
    return saved !== null && offersThinking(model, saved) ? saved : defaultThinking(model);
}

function save(dataDir: string, item: PicoSettings, ifRevision: string | undefined): void {
    try {
        writeSettings(dataDir, item, { ifRevision });
    } catch (error) {
        if (error instanceof SettingsConflictError) {
            throw conflict(error.path, error.expected, error.actual);
        }
        throw ioError(error);
    }
}

function conflict(settingsFile: string, expected: string, actual: string): CliError {
    return new CliError(
        "CONFLICT",
        `${settingsFile} changed since revision ${expected}; read it again with \`pico settings get\` and retry.`,
        { details: { expected, actual } },
    );
}
