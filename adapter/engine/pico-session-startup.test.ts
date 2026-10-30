import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import { exited, fakeMcpServer } from "./testing/mcp-fixture.ts";
import {
    createMockModel,
    lockCredentialStore,
    mockAuthStorage,
    picoWorkspace,
    unauthenticatedAuthStorage,
    withoutProviderCredentials,
    writeMockProviderKey,
} from "./testing/session-fixture.ts";

describe("proposal.0001 credential store", () => {
    test("a store Pico may not write to names the store, the cause and the Autonomous limitation", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        await lockCredentialStore(agentDir);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [],
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.ok(
                    error.message.includes(path.join(agentDir, "agent.db")),
                    `the message does not name the store: ${error.message}`,
                );
                assert.match(error.message, /readonly database/);
                assert.match(error.message, /Autonomous/);
                assert.ok(
                    error.message.includes("~/.omp"),
                    `the message does not name ~/.omp: ${error.message}`,
                );
                return true;
            },
        );
    });

    test("a store that cannot be opened names the store and the cause without blaming Autonomous", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        fs.mkdirSync(path.join(agentDir, "agent.db"));

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [],
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.ok(
                    error.message.includes(path.join(agentDir, "agent.db")),
                    `the message does not name the store: ${error.message}`,
                );
                assert.match(error.message, /unable to open database file/);
                assert.doesNotMatch(error.message, /Autonomous/);
                return true;
            },
        );
    });

    test("the store Pico opened is closed when the session is disposed", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        writeMockProviderKey(agentDir);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        const store = session.engine.modelRegistry.authStorage;

        await session.dispose();

        await assert.rejects(store.credentials.reload(), "Pico left its own credential store open");
    });

    test("a store the caller injected outlives the session", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const authStorage = await mockAuthStorage(agentDir);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage,
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });

        await session.dispose();

        await authStorage.credentials.reload();
    });
});

describe("proposal.0001 model selection", () => {
    test("a configuration that resolves no model fails creation instead of substituting one", async t => {
        withoutProviderCredentials(t);
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({ cwd, agentDir, mcpServers: [] }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /no model/i);
                assert.ok(
                    error.message.includes(cwd),
                    `the message does not say which project has no model: ${error.message}`,
                );
                return true;
            },
        );
    });

    test("a model Oh My Pi substituted for the configured one fails creation", async t => {
        const { cwd, agentDir } = picoWorkspace(
            t,
            "modelRoles:\n  default: openai/pico-no-such-model\n",
        );
        const authStorage = await mockAuthStorage(agentDir);
        authStorage.keys.setRuntime("anthropic", "test-key");

        await assert.rejects(
            createPicoSession({ cwd, agentDir, mcpServers: [], authStorage }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /openai\/pico-no-such-model/);
                assert.match(error.message, /substitute/i);
                return true;
            },
        );
    });

    test("a model whose credentials cannot be resolved fails creation", async t => {
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [],
                authStorage: await unauthenticatedAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /credential/i);
                assert.match(error.message, /mock/);
                return true;
            },
        );
    });

    test("a failure after the engine exists still terminates the MCP servers", async t => {
        withoutProviderCredentials(t);
        const { cwd, agentDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "fake.pid");

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [fakeMcpServer("fake", { flags: ["--pid-file", pidFile] })],
            }),
            PicoSessionError,
        );

        assert.ok(
            fs.existsSync(pidFile),
            "the MCP server never started, so nothing was left to terminate",
        );
        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        assert.ok(await exited(pid), `the MCP server (pid ${pid}) outlived the failed session`);
    });
});
