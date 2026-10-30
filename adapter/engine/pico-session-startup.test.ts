import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import {
    createMockModel,
    lockCredentialStore,
    picoWorkspace,
    withoutProviderCredentials,
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
});
