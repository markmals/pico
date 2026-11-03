import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import type { Cleanups } from "../engine/testing/session-fixture.ts";

import { createPicoModelRegistry, loadCatalog, modelValue } from "../engine/model-catalog.ts";
import { createPicoSession } from "../engine/pico-session.ts";
import { picoWorkspace, withoutProviderCredentials } from "../engine/testing/session-fixture.ts";
import { startFakeLmStudio } from "./fake-lm-studio.ts";

const MEMORY_TOKEN = "3f2c1a7e-pico-verify";
const REPLY = "pico verified";

const pending: Array<() => void | Promise<void>> = [];
const cleanups: Cleanups = {
    after(cleanup) {
        pending.push(cleanup);
    },
};

afterEach(async () => {
    while (pending.length > 0) await pending.pop()?.();
});

/** The fake server, published to OMP's built-in LM Studio provider for one test. */
function useFakeLmStudio(): void {
    const server = startFakeLmStudio({ memoryToken: MEMORY_TOKEN, reply: REPLY });
    const previous = process.env.LM_STUDIO_BASE_URL;
    process.env.LM_STUDIO_BASE_URL = server.baseUrl;
    cleanups.after(() => {
        server.stop();
        if (previous === undefined) delete process.env.LM_STUDIO_BASE_URL;
        else process.env.LM_STUDIO_BASE_URL = previous;
    });
}

/** Env vars `isBunTestRuntime()` reads; OMP's registry refuses to fetch while any marks a test. */
const TEST_RUNTIME_ENV = ["NODE_ENV", "BUN_ENV", "PI_TEST_RUNTIME"];

/**
 * The registry a Pico session uses, built the way `pico` builds it. Its fetch is chosen in the
 * constructor and disabled under a Bun test runtime, so only that call runs unmarked; the rest
 * of the session keeps the markers the test runner set.
 */
async function picoRegistry(agentDir: string, dataDir: string) {
    const authStorage = await discoverAuthStorage(agentDir);
    cleanups.after(() => authStorage.close());
    const marks = TEST_RUNTIME_ENV.map(variable => [variable, process.env[variable]] as const);
    for (const [variable] of marks) delete process.env[variable];
    try {
        return { authStorage, registry: createPicoModelRegistry(authStorage, dataDir) };
    } finally {
        for (const [variable, value] of marks) {
            if (value !== undefined) process.env[variable] = value;
        }
    }
}

function lastAssistantText(engine: AgentSession): string {
    const content = engine.getLastAssistantMessage()?.content ?? [];
    return content.map(block => (block.type === "text" ? block.text : "")).join("");
}

/** A cold discovery pass probes every local provider Oh My Pi knows, which outruns the 5 s default. */
const TIMEOUT_MS = 30_000;

describe("proposal.0007 the offline model `mise run pico:verify` drives", () => {
    test(
        "discovery lists the fake server's one model as lm-studio/echo",
        async () => {
            withoutProviderCredentials(cleanups);
            useFakeLmStudio();
            const { agentDir, dataDir } = picoWorkspace(cleanups);

            const { registry } = await picoRegistry(agentDir, dataDir);

            expect((await loadCatalog(registry)).map(modelValue)).toContain("lm-studio/echo");
        },
        TIMEOUT_MS,
    );

    test(
        "a session runs a whole turn through it and remembers the first prompt",
        async () => {
            withoutProviderCredentials(cleanups);
            useFakeLmStudio();
            const { cwd, agentDir, dataDir } = picoWorkspace(cleanups);
            const { authStorage, registry } = await picoRegistry(agentDir, dataDir);
            const session = await createPicoSession({
                cwd,
                agentDir,
                dataDir,
                mcpServers: [],
                authStorage,
                modelRegistry: registry,
                startOn: { defaultModel: "lm-studio/echo", defaultThinking: "off" },
            });
            cleanups.after(() => session.dispose());

            await session.engine.prompt(`Remember ${MEMORY_TOKEN} for the next time this opens.`);
            await session.writesSettled();

            expect(fs.readFileSync(path.join(cwd, "restart-note.txt"), "utf8")).toBe(
                `${MEMORY_TOKEN}\n`,
            );
            expect(
                session.engine
                    .getTodoPhases()
                    .flatMap(phase => phase.tasks.map(task => task.content)),
            ).toEqual([`Remember ${MEMORY_TOKEN}`]);
            expect(lastAssistantText(session.engine)).toBe(REPLY);

            await session.engine.prompt("what did you remember?");

            expect(lastAssistantText(session.engine)).toBe(`remembered:${MEMORY_TOKEN}`);
        },
        TIMEOUT_MS,
    );
});

describe("proposal.0007 starting a session on a model only discovery finds", () => {
    test(
        "a saved default starts a session even when the model cache is cold",
        async () => {
            withoutProviderCredentials(cleanups);
            useFakeLmStudio();
            const { cwd, agentDir, dataDir } = picoWorkspace(cleanups);
            const { authStorage, registry } = await picoRegistry(agentDir, dataDir);

            const session = await createPicoSession({
                cwd,
                agentDir,
                dataDir,
                mcpServers: [],
                authStorage,
                modelRegistry: registry,
                startOn: { defaultModel: "lm-studio/echo", defaultThinking: "off" },
            });
            cleanups.after(() => session.dispose());

            expect(modelValue(session.engine.model!)).toBe("lm-studio/echo");
        },
        TIMEOUT_MS,
    );
});
