import type { SessionConfigSelectOption } from "@agentclientprotocol/sdk";
import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";

import { clampThinkingLevelForModel, getSupportedEfforts } from "@oh-my-pi/pi-catalog";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import { pickDefaultAvailableModel } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import path from "node:path";

import { picoSettings } from "./pico-settings.ts";

/** OMP's built-in `defaultThinkingLevel`, which a Pico session starts from with no level chosen. */
const BUILT_IN_THINKING = "high";

/** One model as `pico models` reports it (proposal.0007). */
export interface CatalogEntry {
    value: string;
    name: string;
    provider: string;
    thinking: { value: string; name: string }[];
    defaultThinking: string;
}

/** A model and the thinking level a session would start it at. */
export interface StartingChoice {
    model: Model<Api>;
    thinking: string;
}

/** OMP's model registry as Pico runs it: no models.yml, its cache in Pico's data directory. */
export function createPicoModelRegistry(authStorage: AuthStorage, dataDir: string): ModelRegistry {
    return new ModelRegistry(authStorage, undefined, {
        settings: picoSettings(),
        ignoreLocalModelConfig: true,
        cacheDbPath: path.join(dataDir, "models.db"),
    });
}

/**
 * The catalog a new session can use, after at most one cache-aware discovery pass: a cold
 * provider cache is filled once, and a warm one makes no request.
 */
export async function loadCatalog(registry: ModelRegistry): Promise<Model<Api>[]> {
    await registry.refresh("online-if-uncached");
    return registry.getAvailable();
}

/** A catalog model by its `provider/id` value, refreshing a cold cache only when it is missing. */
export async function findCatalogModel(
    registry: ModelRegistry,
    value: string,
): Promise<Model<Api> | undefined> {
    const cached = registry.getAvailable().find(model => modelValue(model) === value);
    if (cached) return cached;
    return (await loadCatalog(registry)).find(model => modelValue(model) === value);
}

/** OMP's choice for a session given no model: its first catalog model with usable credentials. */
export async function builtInChoice(registry: ModelRegistry): Promise<StartingChoice | undefined> {
    const models = await loadCatalog(registry);
    const model = pickDefaultAvailableModel(models, provider => registry.hasConcreteAuth(provider));
    return model && { model, thinking: defaultThinking(model) };
}

/** Whether the model's Thinking option offers the level. */
export function offersThinking(model: Model<Api>, level: string): boolean {
    return thinkingChoices(model).some(choice => choice.value === level);
}

/** The `provider/id` value Pico's Model option and Pico settings name a model by. */
export function modelValue(model: Model<Api>): string {
    return `${model.provider}/${model.id}`;
}

/**
 * Pico's Thinking option for a model: Off, Auto, then its levels in OMP's order. A model without
 * reasoning offers only Off, because no other level changes anything for it (proposal.0007).
 */
export function thinkingChoices(model: Model<Api>): SessionConfigSelectOption[] {
    const off = { value: "off", name: "Off" };
    if (!model.reasoning) return [off];
    return [
        off,
        { value: "auto", name: "Auto", description: "Auto-detect per prompt" },
        ...getSupportedEfforts(model).map(level => ({ value: level, name: level })),
    ];
}

/** What Pico's Thinking option shows when a session starts on the model with no level chosen. */
export function defaultThinking(model: Model<Api>): string {
    return clampThinkingLevelForModel(model, BUILT_IN_THINKING as never) ?? "off";
}

export function catalogEntry(model: Model<Api>): CatalogEntry {
    return {
        value: modelValue(model),
        name: model.name,
        provider: model.provider,
        thinking: thinkingChoices(model).map(({ value, name }) => ({ value, name })),
        defaultThinking: defaultThinking(model),
    };
}
