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
import { settingsFilePath, writeSettings } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { modelNotFound } from "./models.ts";
import { ioError, readSettingsFile } from "./settings-file.ts";

interface UpdateOptions {
    defaultModel?: string;
    defaultThinking?: string;
    ifRevision?: string;
    dryRun?: boolean;
}

/**
 * Checks in the proposal's order: the file, its revision, then the catalog; only then writes,
 * and only when the document would change and this is not a dry run.
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
        if (options.ifRevision !== undefined && options.ifRevision !== state.revision) {
            throw new CliError(
                "CONFLICT",
                `${settingsFile} changed since revision ${options.ifRevision}; read it again with \`pico settings get\` and retry.`,
                { details: { expected: options.ifRevision, actual: state.revision } },
            );
        }
        const after = await chosenDefault(context, state.item, options, settingsFile);
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
        if (options.dryRun !== true) save(context.dataDir, after);
        return {
            settingsFile,
            dryRun: options.dryRun === true,
            changed: true,
            before,
            after: { revision, item: after },
        };
    };
}

async function chosenDefault(
    context: HandlerContext,
    saved: PicoSettings,
    options: UpdateOptions,
    settingsFile: string,
): Promise<PicoSettings> {
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

function save(dataDir: string, item: PicoSettings): void {
    try {
        writeSettings(dataDir, item);
    } catch (error) {
        throw ioError(error);
    }
}
