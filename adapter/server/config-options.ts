// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { RequestError } from "@agentclientprotocol/sdk";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";

import type { PicoSession } from "../engine/pico-session.ts";

const MODEL_CONFIG_ID = "model";
const THINKING_CONFIG_ID = "thinking";
const THINKING_OFF = "off";

/** What the config options read from the engine session. */
type ModelState = Pick<
    AgentSession,
    "model" | "getAvailableModels" | "getAvailableThinkingLevels" | "configuredThinkingLevel"
>;

/** The session's config options, in the order the proposal fixes: model, then thinking. */
export function configOptionsOf(engine: ModelState): SessionConfigOption[] {
    const current = currentModel(engine);
    const thinkingChoices = thinkingOptions(engine);
    return [
        {
            id: MODEL_CONFIG_ID,
            name: "Model",
            category: "model",
            type: "select",
            currentValue: modelValue(current),
            options: selectableModels(engine).map(model => ({
                value: modelValue(model),
                name: model.name,
                description: modelValue(model),
            })),
        },
        {
            id: THINKING_CONFIG_ID,
            name: "Thinking",
            category: "thought_level",
            type: "select",
            currentValue: currentThinking(engine, current, thinkingChoices),
            options: thinkingChoices,
        },
    ];
}

/**
 * Applies one `session/set_config_option` request. A value outside the options is the client's
 * mistake (invalid params); a model whose credentials cannot be used is reported with its cause.
 */
export async function applyConfigOption(
    session: PicoSession,
    configId: string,
    value: string | boolean,
): Promise<void> {
    if (configId !== MODEL_CONFIG_ID && configId !== THINKING_CONFIG_ID) {
        throw RequestError.invalidParams(undefined, `unknown config option "${configId}"`);
    }
    if (typeof value !== "string") {
        throw RequestError.invalidParams(
            undefined,
            `config option "${configId}" takes a string value`,
        );
    }
    if (configId === MODEL_CONFIG_ID) {
        await selectModel(session, value);
        return;
    }
    selectThinking(session, value);
}

async function selectModel(session: PicoSession, value: string): Promise<void> {
    const model = selectableModels(session.engine).find(
        candidate => modelValue(candidate) === value,
    );
    if (!model) {
        throw RequestError.invalidParams(
            undefined,
            `"${value}" is not one of this session's models`,
        );
    }
    try {
        await session.selectModel(model);
    } catch (error) {
        throw RequestError.internalError(
            undefined,
            error instanceof Error ? error.message : String(error),
        );
    }
}

function selectThinking(session: PicoSession, value: string): void {
    const offered = thinkingOptions(session.engine).some(option => option.value === value);
    const level = offered ? parseConfiguredThinkingLevel(value) : undefined;
    if (!level) {
        const model = modelValue(currentModel(session.engine));
        throw RequestError.invalidParams(
            undefined,
            `"${value}" is not a thinking level ${model} offers`,
        );
    }
    session.selectThinkingLevel(level);
}

function modelValue(model: Model<Api>): string {
    return `${model.provider}/${model.id}`;
}

function currentModel(engine: ModelState): Model<Api> {
    const model = engine.model;
    // Session creation fails without a model, so a live session always has one.
    if (!model) throw new Error("a Pico session has no model");
    return model;
}

/** OMP's available models, with the current one first when OMP's list leaves it out. */
function selectableModels(engine: ModelState): Model<Api>[] {
    const current = currentModel(engine);
    const available = engine.getAvailableModels();
    const listed = available.some(model => modelValue(model) === modelValue(current));
    return listed ? available : [current, ...available];
}

function thinkingOptions(engine: ModelState): SessionConfigSelectOption[] {
    return [
        { value: THINKING_OFF, name: "Off" },
        { value: "auto", name: "Auto", description: "Auto-detect per prompt" },
        ...engine.getAvailableThinkingLevels().map(level => ({ value: level, name: level })),
    ];
}

function currentThinking(
    engine: ModelState,
    model: Model<Api>,
    choices: readonly SessionConfigSelectOption[],
): string {
    const configured = engine.configuredThinkingLevel();
    if (!model.reasoning || configured === undefined) return THINKING_OFF;
    return choices.some(choice => choice.value === configured) ? configured : THINKING_OFF;
}
