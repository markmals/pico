import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SavedDefault } from "./pico-session.ts";
import type { Cleanups } from "./testing/session-fixture.ts";

import { builtInChoice, createPicoModelRegistry, modelValue } from "./model-catalog.ts";
import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import {
    picoWorkspace,
    unauthenticatedAuthStorage,
    withoutProviderCredentials,
} from "./testing/session-fixture.ts";
import { testProvider } from "./testing/test-provider.ts";

async function registryWithTestProvider(t: Cleanups) {
    withoutProviderCredentials(t);
    const workspace = picoWorkspace(t);
    const authStorage = await unauthenticatedAuthStorage(workspace.dataDir);
    const modelRegistry = createPicoModelRegistry(authStorage, workspace.dataDir);
    testProvider().register(modelRegistry);
    return { workspace, authStorage, modelRegistry };
}

async function startSession(t: Cleanups, startOn?: SavedDefault, registry?: ModelRegistry) {
    const { workspace, authStorage, modelRegistry } = await registryWithTestProvider(t);
    const session = await createPicoSession({
        ...workspace,
        mcpServers: [],
        authStorage,
        modelRegistry: registry ?? modelRegistry,
        startOn,
    });
    t.after(() => session.dispose());
    return { session, modelRegistry };
}

describe("proposal.0007 starting a session", () => {
    test("a session starts on the saved default model and thinking level", async t => {
        const { session } = await startSession(t, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
        });

        assert.equal(modelValue(session.engine.model!), "pico-test/beta");
        assert.equal(session.engine.configuredThinkingLevel(), "low");
    });

    test("a saved model that is not in the catalog fails the session and names it", async t => {
        await assert.rejects(
            startSession(t, { defaultModel: "pico-test/gamma", defaultThinking: "off" }),
            (error: unknown) =>
                error instanceof PicoSessionError &&
                /pico-test\/gamma/.test(error.message) &&
                /pico settings update/.test(error.message),
        );
    });

    test("a saved level the model does not offer fails the session and names the model", async t => {
        await assert.rejects(
            startSession(t, { defaultModel: "pico-test/alpha", defaultThinking: "high" }),
            (error: unknown) =>
                error instanceof PicoSessionError &&
                /pico-test\/alpha/.test(error.message) &&
                /high/.test(error.message),
        );
    });

    test("with no saved default, a session starts on OMP's built-in choice at its default level", async t => {
        const { session, modelRegistry } = await startSession(t);

        const expected = await builtInChoice(modelRegistry);
        assert.ok(expected, "the test provider offers no model");
        assert.equal(modelValue(session.engine.model!), modelValue(expected.model));
        const thinking = session.engine.configuredThinkingLevel() ?? "off";
        assert.equal(thinking, expected.thinking);
    });
});
