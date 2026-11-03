import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import { catalogEntry, loadCatalog, modelValue } from "../../engine/model-catalog.ts";
import { CliError } from "../errors.ts";

export function modelsList(context: HandlerContext): CommandHandler {
    return async input => {
        const { registry, providerCredentials } = await context.openCatalog();
        const provider = input.options.provider;
        const models = (await loadCatalog(registry)).filter(
            model => provider === undefined || model.provider === provider,
        );
        return { providerCredentials, items: models.map(catalogEntry) };
    };
}

export function modelsGet(context: HandlerContext): CommandHandler {
    return async input => {
        const value = input.arguments.model as string;
        const { registry, providerCredentials } = await context.openCatalog();
        const model = (await loadCatalog(registry)).find(entry => modelValue(entry) === value);
        if (!model) throw modelNotFound(value);
        return { providerCredentials, item: catalogEntry(model) };
    };
}

/** A model the catalog lacks: unknown, or its provider has no usable credentials. */
export function modelNotFound(value: string): CliError {
    return new CliError(
        "NOT_FOUND",
        `${value} is not a model you can use: it is unknown, or its provider has no usable credentials. \`pico models list\` lists the models you can use.`,
        { details: { model: value, alternatives: "pico models list" } },
    );
}
