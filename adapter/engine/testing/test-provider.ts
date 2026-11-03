import type { MockModel, MockModelOptions } from "@oh-my-pi/pi-ai/providers/mock";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";

/** The provider the fixture registers; its models are `pico-test/alpha` and `pico-test/beta`. */
export const TEST_PROVIDER = "pico-test";

export interface TestProviderModels {
    /** Answers for `pico-test/alpha`, a model without reasoning. */
    readonly alpha: MockModel;
    /** Answers for `pico-test/beta`, a reasoning model offering low, medium and high. */
    readonly beta: MockModel;
}

export interface TestProviderScripts {
    readonly alpha?: MockModelOptions;
    readonly beta?: MockModelOptions;
}

export interface TestProvider {
    readonly models: TestProviderModels;
    /** Adds the provider to a session's model registry, as a provider other than OMP's own. */
    register(registry: ModelRegistry): void;
}

/** The saved default that starts a session on `pico-test/alpha`. */
export const ALPHA_DEFAULT = { defaultModel: `${TEST_PROVIDER}/alpha`, defaultThinking: "off" };

const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const MODEL_SPECS = [
    {
        id: "alpha",
        name: "Alpha",
        reasoning: false,
        input: ["text"],
        cost,
        contextWindow: 200000,
        maxTokens: 32000,
    },
    {
        id: "beta",
        name: "Beta",
        reasoning: true,
        thinking: { efforts: ["low", "medium", "high"] },
        input: ["text"],
        cost,
        contextWindow: 200000,
        maxTokens: 32000,
    },
];

/** A two-model provider whose requests go to the scripted model registered under each id. */
export function testProvider(scripts: TestProviderScripts = {}): TestProvider {
    const models: TestProviderModels = {
        alpha: scripted("alpha", scripts.alpha, { content: ["from alpha"] }),
        beta: scripted("beta", scripts.beta, { content: ["from beta"] }),
    };
    const byId: Record<string, MockModel> = { alpha: models.alpha, beta: models.beta };
    return {
        models,
        register: registry =>
            registry.registerProvider(TEST_PROVIDER, {
                baseUrl: "http://127.0.0.1:9",
                apiKey: "test",
                api: TEST_PROVIDER,
                streamSimple: (model, context, options) =>
                    (byId[model.id] as MockModel).stream(model, context, options),
                models: MODEL_SPECS,
            } as Parameters<ModelRegistry["registerProvider"]>[1]),
    };
}

function scripted(
    id: string,
    options: MockModelOptions | undefined,
    fallback: NonNullable<MockModelOptions["handler"]>,
): MockModel {
    return createMockModel({ handler: fallback, ...options, id, provider: TEST_PROVIDER });
}
