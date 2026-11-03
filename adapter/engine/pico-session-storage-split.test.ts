import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { getBlobsDir } from "@oh-my-pi/pi-utils";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Cleanups } from "./testing/session-fixture.ts";

import { createPicoSession } from "./pico-session.ts";
import { initializeRuntimeStorage } from "./runtime-storage.ts";
import {
    createMockModel,
    picoWorkspace,
    storeMockProviderKey,
    useAsProcessAgentDir,
} from "./testing/session-fixture.ts";

/**
 * The split proposal.0004 makes: Pico's own engine directory becomes the SDK's
 * process-wide runtime storage root, while the user's agent directory stays the
 * configuration source every session is given explicitly. `initializeRuntimeStorage`
 * performs this redirect once at startup; a test performs it for one session.
 */
function splitProcessRoot(t: Cleanups, dataDir: string): string {
    const engineDir = path.join(dataDir, "engine");
    fs.mkdirSync(engineDir, { recursive: true });
    useAsProcessAgentDir(t, engineDir);
    return engineDir;
}

describe("proposal.0004 runtime storage", () => {
    test("the redirect moves the SDK's storage without moving what Pico launches", async t => {
        const { agentDir, dataDir } = picoWorkspace(t);
        fs.chmodSync(dataDir, 0o755);
        // The user's own directory, as the process resolves it before Pico starts.
        useAsProcessAgentDir(t, agentDir);
        process.env.OMP_PROFILE = "pico-split-profile";
        t.after(() => delete process.env.OMP_PROFILE);

        const configSource = initializeRuntimeStorage(dataDir);
        assert.equal(
            fs.statSync(path.join(dataDir, "engine")).mode & 0o777,
            0o700,
            "SDK history support must stay private even when the parent directory already existed",
        );

        assert.equal(
            configSource,
            agentDir,
            "the user's configuration directory was not reported back",
        );
        assert.ok(
            getBlobsDir().startsWith(path.join(dataDir, "engine")),
            "the SDK still stores blobs in the user's agent directory",
        );
        assert.equal(
            process.env.PI_CODING_AGENT_DIR,
            agentDir,
            "an MCP server or Sesh child session would start in Pico's storage",
        );
        assert.equal(
            process.env.OMP_PROFILE,
            "pico-split-profile",
            "a process Pico launches lost the user's profile",
        );
    });
});

describe("proposal.0004 storage after the split", () => {
    test("credentials stay in the user's agent directory and are not copied into Pico's", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const engineDir = splitProcessRoot(t, dataDir);
        await storeMockProviderKey(agentDir);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());
        await session.engine.prompt("hello");

        assert.ok(
            fs.existsSync(path.join(agentDir, "agent.db")),
            "the credential store was not opened in the user's agent directory",
        );
        assert.deepEqual(
            fs
                .readdirSync(engineDir)
                .filter(entry => entry.startsWith("agent.db") || entry === "models.yml"),
            [],
            "Pico's engine directory holds a copy of the user's credentials",
        );
    });

    test("a saved conversation stays in Pico's storage and adds no history to the user's agent directory", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        await storeMockProviderKey(agentDir);
        const sessionDir = path.join(dataDir, "sessions", path.basename(cwd));
        fs.mkdirSync(sessionDir, { recursive: true });
        const manager = await SessionManager.inMemory(cwd).persistCopy({
            sessionDir,
            suppressBreadcrumb: true,
        });
        const file = manager.getSessionFile();
        assert.ok(file, "the journal was never materialized");

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
            sessionManager: manager,
        });
        await session.engine.prompt("remember rambutan");
        await session.dispose();

        assert.ok(file.startsWith(sessionDir), "the journal is not in Pico's own session bucket");
        assert.match(
            fs.readFileSync(file, "utf8"),
            /rambutan/,
            "the conversation never reached Pico's journal",
        );
        for (const entry of ["sessions", "blobs", "history.db"]) {
            assert.ok(
                !fs.existsSync(path.join(agentDir, entry)),
                `the user's agent directory gained ${entry}`,
            );
        }
    });
});
