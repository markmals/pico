import type {
    NewSessionResponse,
    PromptResponse,
    SessionConfigOption,
    SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";

import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";
import type { TestProviderModels, TestProviderScripts } from "../engine/testing/test-provider.ts";
import type { ConnectedClient } from "./agent-harness.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import { installTestProvider } from "../engine/testing/test-provider.ts";
import { connectPicoAgent, INVALID_PARAMS, requestError } from "./agent-harness.ts";
import { mockEngine, removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";

/** Provider keys in the environment would add the machine's own models to the menu. */
const hiddenCredentials: [string, string][] = [];

beforeAll(() => {
    for (const [variable, value] of Object.entries(process.env)) {
        if (value === undefined || !/(_KEY|_TOKEN|_CREDENTIALS)$/.test(variable)) continue;
        hiddenCredentials.push([variable, value]);
        delete process.env[variable];
    }
});

afterAll(() => {
    for (const [variable, value] of hiddenCredentials.splice(0)) process.env[variable] = value;
    removeTemporaryDirectories();
});

const open: ConnectedClient[] = [];

afterEach(async () => {
    for (const client of open.splice(0)) await client.close();
});

interface ModelSession {
    readonly client: ConnectedClient;
    readonly sessionId: string;
    readonly models: TestProviderModels;
    readonly response: NewSessionResponse;
    /** The engine session behind the ACP session, for changes the engine makes on its own. */
    readonly session: PicoSession;
    set(configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse>;
    prompt(text: string): Promise<PromptResponse>;
}

async function startModelSession(scripts: TestProviderScripts = {}): Promise<ModelSession> {
    const cwd = temporaryProject();
    const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pico-agent-dir-")));
    const models = installTestProvider(cwd, scripts);
    const authStorage = await discoverAuthStorage(agentDir);
    let created: PicoSession | undefined;
    const client = connectPicoAgent({
        version: "0.0.0-test",
        createSession: async (sessionCwd, mcpServers) => {
            created = await createPicoSession({
                cwd: sessionCwd,
                mcpServers,
                agentDir,
                authStorage,
            });
            return created;
        },
    });
    open.push(client);
    await client.initialize();
    const response = (await client.agent.request("session/new", {
        cwd,
        mcpServers: [],
    })) as NewSessionResponse;
    const sessionId = response.sessionId;
    if (!created) throw new Error("the session factory never ran");
    return {
        client,
        sessionId,
        models,
        response,
        session: created,
        set: (configId, value) =>
            client.agent.request(
                "session/set_config_option",
                typeof value === "boolean"
                    ? { sessionId, configId, type: "boolean", value }
                    : { sessionId, configId, value },
            ) as Promise<SetSessionConfigOptionResponse>,
        prompt: text =>
            client.agent.request("session/prompt", {
                sessionId,
                prompt: [{ type: "text", text }],
            }) as Promise<PromptResponse>,
    };
}

function option(options: SessionConfigOption[] | null | undefined, id: string) {
    const found = (options ?? []).find(candidate => candidate.id === id);
    if (!found || found.type !== "select") throw new Error(`no select option "${id}"`);
    return found;
}

function values(options: SessionConfigOption[] | null | undefined, id: string): string[] {
    return option(options, id).options.flatMap(entry =>
        "value" in entry ? [entry.value] : entry.options.map(nested => nested.value),
    );
}

describe("proposal.0001 config options on a new session", () => {
    test("session/new offers the available models and the thinking levels, and no mode", async () => {
        const { response } = await startModelSession();

        expect(Object.keys(response).toSorted()).toEqual(["configOptions", "sessionId"]);
        const model = option(response.configOptions, "model");
        expect(model).toMatchObject({
            name: "Model",
            category: "model",
            currentValue: "pico-test/alpha",
        });
        // Models OMP offers on this machine without credentials (on-device ones) are listed too.
        expect(model.options).toEqual(
            expect.arrayContaining([
                { value: "pico-test/alpha", name: "Alpha", description: "pico-test/alpha" },
                { value: "pico-test/beta", name: "Beta", description: "pico-test/beta" },
            ]),
        );
        const thinking = option(response.configOptions, "thinking");
        expect(thinking).toMatchObject({
            name: "Thinking",
            category: "thought_level",
            currentValue: "off",
        });
        expect(thinking.options).toEqual([
            { value: "off", name: "Off" },
            { value: "auto", name: "Auto", description: "Auto-detect per prompt" },
        ]);
        expect((response.configOptions ?? []).map(entry => entry.id)).toEqual([
            "model",
            "thinking",
        ]);
    });

    test("the session's current model is always among the model options", async () => {
        const engine = await mockEngine([{ content: ["ok"] }]);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: engine.createSession,
        });
        open.push(client);
        await client.initialize();

        const response = (await client.agent.request("session/new", {
            cwd: temporaryProject(),
            mcpServers: [],
        })) as NewSessionResponse;

        const model = option(response.configOptions, "model");
        expect(model.currentValue).toBe("mock/mock-model");
        expect(values(response.configOptions, "model")).toContain("mock/mock-model");
    });
});

describe("proposal.0001 choosing a model and thinking level", () => {
    test("a chosen model answers the next prompt and brings its own thinking levels", async () => {
        const session = await startModelSession();

        const response = await session.set("model", "pico-test/beta");
        const alphaCallsAfterSwitch = session.models.alpha.calls.length;
        const turn = await session.prompt("hello");

        expect(option(response.configOptions, "model").currentValue).toBe("pico-test/beta");
        expect(values(response.configOptions, "thinking")).toEqual([
            "off",
            "auto",
            "low",
            "medium",
            "high",
        ]);
        expect(turn.stopReason).toBe("end_turn");
        expect(session.models.beta.calls.length).toBeGreaterThan(0);
        expect(session.models.alpha.calls.length).toBe(alphaCallsAfterSwitch);
    });

    test("a chosen thinking level reaches the next request", async () => {
        const session = await startModelSession();
        await session.set("model", "pico-test/beta");

        const response = await session.set("thinking", "high");
        await session.prompt("think hard");

        expect(option(response.configOptions, "thinking").currentValue).toBe("high");
        expect(String(session.models.beta.calls.at(-1)?.options?.reasoning)).toBe("high");
    });

    test("switching to a model that cannot reason reports thinking as off", async () => {
        const session = await startModelSession();
        await session.set("model", "pico-test/beta");
        await session.set("thinking", "high");

        const response = await session.set("model", "pico-test/alpha");

        expect(option(response.configOptions, "thinking").currentValue).toBe("off");
        expect(values(response.configOptions, "thinking")).toEqual(["off", "auto"]);
    });

    test("a change while a turn runs applies from the next model request", async () => {
        const session = await startModelSession({
            alpha: {
                responses: [
                    {
                        content: [
                            { type: "toolCall", name: "bash", arguments: { command: "sleep 1" } },
                        ],
                    },
                ],
                handler: { content: ["alpha finished"] },
            },
            beta: { handler: { content: ["beta finished"] } },
        });

        const turn = session.prompt("run it");
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "tool_call",
        );
        const alphaCallsBeforeSwitch = session.models.alpha.calls.length;
        await session.set("model", "pico-test/beta");

        expect((await turn).stopReason).toBe("end_turn");
        expect(session.models.beta.calls.length).toBeGreaterThan(0);
        expect(session.models.alpha.calls.length).toBe(alphaCallsBeforeSwitch);
    });
});

describe("proposal.0001 config option updates", () => {
    test("a change made through set_config_option sends no extra update", async () => {
        const session = await startModelSession();

        await session.set("model", "pico-test/beta");
        await session.set("thinking", "medium");
        await session.prompt("hello");

        expect(
            session.client
                .updatesFor(session.sessionId)
                .filter(update => update.sessionUpdate === "config_option_update"),
        ).toEqual([]);
    });

    test("a change the engine makes on its own reaches the client as an update", async () => {
        const session = await startModelSession();
        await session.set("model", "pico-test/beta");

        session.session.engine.setThinkingLevel(parseConfiguredThinkingLevel("low"), false);
        const update = await session.client.waitForUpdate(
            session.sessionId,
            candidate => candidate.sessionUpdate === "config_option_update",
        );

        if (update.sessionUpdate !== "config_option_update") throw new Error("unreachable");
        expect(option(update.configOptions, "thinking").currentValue).toBe("low");
        expect(option(update.configOptions, "model").currentValue).toBe("pico-test/beta");
    });

    test("a change the engine makes while a model choice is refused still reaches the client", async () => {
        const session = await startModelSession();
        await session.set("model", "pico-test/beta");
        await session.set("thinking", "high");
        const registry = session.session.engine.modelRegistry;
        const checking = Promise.withResolvers<void>();
        const refuse = Promise.withResolvers<void>();
        registry.getApiKey = async () => {
            checking.resolve();
            await refuse.promise;
            throw new Error("credential command failed");
        };

        const refused = requestError(session.set("model", "pico-test/alpha"));
        await checking.promise;
        session.session.engine.setThinkingLevel(parseConfiguredThinkingLevel("low"), false);
        refuse.resolve();
        await refused;
        const update = await session.client.waitForUpdate(
            session.sessionId,
            candidate => candidate.sessionUpdate === "config_option_update",
        );

        if (update.sessionUpdate !== "config_option_update") throw new Error("unreachable");
        expect(option(update.configOptions, "thinking").currentValue).toBe("low");
        expect(option(update.configOptions, "model").currentValue).toBe("pico-test/beta");
    });

    test("a model choice refused for its credentials reports the cause and keeps the model", async () => {
        const session = await startModelSession();
        session.session.engine.modelRegistry.getApiKey = async () => {
            throw new Error("credential command failed");
        };

        const error = await requestError(session.set("model", "pico-test/beta"));

        expect(error.message).toContain("pico-test/beta");
        expect(error.message).toContain("credential command failed");
        expect(session.session.engine.model?.id).toBe("alpha");
    });
});

describe("proposal.0001 rejected config changes", () => {
    test.each([
        ["model", "pico-test/gamma", "pico-test/gamma"],
        ["thinking", "high", "high"],
        ["mode", "plan", "mode"],
        ["model", true, "model"],
    ] as const)("%s = %p is rejected with invalid params", async (configId, value, named) => {
        const session = await startModelSession();
        const alphaCallsBefore = session.models.alpha.calls.length;

        const error = await requestError(session.set(configId, value));
        await session.prompt("hello");

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain(String(named));
        expect(session.session.engine.model?.id).toBe("alpha");
        expect(session.session.engine.configuredThinkingLevel()).toBeUndefined();
        expect(session.models.alpha.calls.length).toBeGreaterThan(alphaCallsBefore);
        expect(session.models.beta.calls).toEqual([]);
    });

    test("a change for an unknown session is rejected with invalid params", async () => {
        const session = await startModelSession();

        const error = await requestError(
            session.client.agent.request("session/set_config_option", {
                sessionId: "no-such-session",
                configId: "model",
                value: "pico-test/beta",
            } as never),
        );

        expect(error.code).toBe(INVALID_PARAMS);
    });
});
