import type { MockModel, MockModelOptions } from "@oh-my-pi/pi-ai/providers/mock";

import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import fs from "node:fs";
import path from "node:path";

/** The provider the fixture registers; its models are `pico-test/alpha` and `pico-test/beta`. */
export const TEST_PROVIDER = "pico-test";

export interface TestProviderModels {
    /** Answers for `pico-test/alpha`, a model without reasoning and the project's configured default. */
    readonly alpha: MockModel;
    /** Answers for `pico-test/beta`, a reasoning model offering low, medium and high. */
    readonly beta: MockModel;
}

/** Where the provider's stream function finds the scripted models of the test that installed them. */
const ROUTER = Symbol.for("pico.test-provider.models");

type Router = Map<string, MockModel>;

function router(): Router {
    const holder = globalThis as unknown as Record<symbol, Router | undefined>;
    holder[ROUTER] ??= new Map();
    return holder[ROUTER];
}

// A project extension, because that is how a real provider other than OMP's own reaches a
// restricted session: its provider survives, its tools do not. The stream function hands each
// request to the scripted model registered under the requested model's id.
const EXTENSION_SOURCE = `const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const route = Symbol.for("pico.test-provider.models");
export default function (pi) {
    pi.registerProvider("${TEST_PROVIDER}", {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "test",
        api: "${TEST_PROVIDER}",
        streamSimple: (model, context, options) => globalThis[route].get(model.id).stream(model, context, options),
        models: [
            { id: "alpha", name: "Alpha", reasoning: false, input: ["text"], cost, contextWindow: 200000, maxTokens: 32000 },
            { id: "beta", name: "Beta", reasoning: true, thinking: { efforts: ["low", "medium", "high"] }, input: ["text"], cost, contextWindow: 200000, maxTokens: 32000 },
        ],
    });
}
`;

export interface TestProviderScripts {
    readonly alpha?: MockModelOptions;
    readonly beta?: MockModelOptions;
}

/**
 * Installs a two-model provider in the project at `cwd` and makes `pico-test/alpha` the project's
 * default model, so a session created there without an injected model starts on it.
 */
export function installTestProvider(
    cwd: string,
    scripts: TestProviderScripts = {},
): TestProviderModels {
    const extensions = path.join(cwd, ".omp", "extensions");
    fs.mkdirSync(extensions, { recursive: true });
    fs.writeFileSync(path.join(extensions, "pico-test-provider.ts"), EXTENSION_SOURCE);
    fs.writeFileSync(
        path.join(cwd, ".omp", "config.yml"),
        `modelRoles:\n  default: ${TEST_PROVIDER}/alpha\n`,
    );
    const models: TestProviderModels = {
        alpha: scripted("alpha", scripts.alpha, { content: ["from alpha"] }),
        beta: scripted("beta", scripts.beta, { content: ["from beta"] }),
    };
    router().set("alpha", models.alpha);
    router().set("beta", models.beta);
    return models;
}

function scripted(
    id: string,
    options: MockModelOptions | undefined,
    fallback: NonNullable<MockModelOptions["handler"]>,
): MockModel {
    return createMockModel({ handler: fallback, ...options, id, provider: TEST_PROVIDER });
}
