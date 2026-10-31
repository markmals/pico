import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PicoSession } from "./pico-session.ts";
import type { Cleanups } from "./testing/session-fixture.ts";

import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import {
    picoWorkspace,
    unauthenticatedAuthStorage,
    withoutProviderCredentials,
} from "./testing/session-fixture.ts";
import { installTestProvider, TEST_PROVIDER } from "./testing/test-provider.ts";

async function sessionOnTestProvider(t: Cleanups) {
    withoutProviderCredentials(t);
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    const models = installTestProvider(cwd);
    const session = await createPicoSession({
        cwd,
        agentDir,
        dataDir,
        mcpServers: [],
        authStorage: await unauthenticatedAuthStorage(agentDir),
    });
    t.after(() => session.dispose());
    const projectConfig = path.join(cwd, ".omp", "config.yml");
    return { session, models, cwd, agentDir, projectConfig };
}

function availableModel(session: PicoSession, id: string) {
    const model = session.engine
        .getAvailableModels()
        .find(candidate => candidate.provider === TEST_PROVIDER && candidate.id === id);
    assert.ok(model, `the engine offers ${TEST_PROVIDER}/${id}`);
    return model;
}

describe("proposal.0001 model selection", () => {
    test("a session starts on the project's configured model", async t => {
        const { session } = await sessionOnTestProvider(t);

        assert.equal(
            `${session.engine.model?.provider}/${session.engine.model?.id}`,
            "pico-test/alpha",
        );
    });

    test("a selected model answers the next prompt, and nothing is persisted", async t => {
        const { session, models, projectConfig, agentDir } = await sessionOnTestProvider(t);
        const configBefore = fs.readFileSync(projectConfig, "utf8");
        const agentFilesBefore = fs.readdirSync(agentDir).toSorted();

        await session.selectModel(availableModel(session, "beta"));
        const alphaCallsBefore = models.alpha.calls.length;
        await session.engine.prompt("hello");

        assert.equal(session.engine.model?.id, "beta");
        assert.ok(models.beta.calls.length > 0, "beta answered");
        assert.equal(models.alpha.calls.length, alphaCallsBefore, "alpha was not asked");
        assert.equal(fs.readFileSync(projectConfig, "utf8"), configBefore);
        assert.ok(
            !fs.existsSync(path.join(agentDir, "config.yml")),
            "no user configuration was written",
        );
        assert.deepEqual(
            fs
                .readdirSync(agentDir)
                .filter(
                    entry =>
                        !agentFilesBefore.includes(entry) &&
                        !entry.startsWith("agent.db") &&
                        !entry.startsWith("models.db"),
                ),
            [],
        );
    });

    test("a model whose credentials cannot be used is refused, and the session keeps its model", async t => {
        const { session } = await sessionOnTestProvider(t);
        const locked = { ...availableModel(session, "beta"), provider: "pico-test-locked" };

        await assert.rejects(
            () => session.selectModel(locked),
            (error: unknown) =>
                error instanceof PicoSessionError && /pico-test-locked\/beta/.test(error.message),
        );
        assert.equal(session.engine.model?.id, "alpha");
    });
});

describe("proposal.0001 thinking level selection", () => {
    test("a selected thinking level reaches the next request, and nothing is persisted", async t => {
        const { session, models, projectConfig } = await sessionOnTestProvider(t);
        const configBefore = fs.readFileSync(projectConfig, "utf8");
        await session.selectModel(availableModel(session, "beta"));

        const high = parseConfiguredThinkingLevel("high");
        assert.ok(high);
        session.selectThinkingLevel(high);
        await session.engine.prompt("think hard");

        assert.equal(session.engine.configuredThinkingLevel(), "high");
        assert.equal(models.beta.calls.at(-1)?.options?.reasoning, "high");
        assert.equal(fs.readFileSync(projectConfig, "utf8"), configBefore);
    });
});
