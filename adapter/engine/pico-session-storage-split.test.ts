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
    boundCredential,
    createMockModel,
    picoWorkspace,
    useAsProcessAgentDir,
} from "./testing/session-fixture.ts";

// SDK storage is Pico-owned; launched programs retain the user's directory and profile.
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

        initializeRuntimeStorage(dataDir);
        assert.equal(
            fs.statSync(path.join(dataDir, "engine")).mode & 0o777,
            0o700,
            "SDK history support must stay private even when the parent directory already existed",
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
    test("Pico's credentials stay Pico's and nothing is written to the user's agent directory", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const engineDir = splitProcessRoot(t, dataDir);
        const { keychain } = await boundCredential(dataDir, "mock");
        const before = fs.readdirSync(agentDir).toSorted();

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());
        await session.engine.prompt("hello");

        assert.deepEqual(
            fs.readdirSync(agentDir).toSorted(),
            before,
            "Pico wrote to the user's agent directory",
        );
        assert.deepEqual(
            fs
                .readdirSync(engineDir)
                .filter(entry => entry.startsWith("agent.db") || entry === "models.yml"),
            [],
            "Pico's engine directory holds an Oh My Pi credential store",
        );
    });

    test("a saved conversation stays in Pico's storage and adds no history to the user's agent directory", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        const { keychain } = await boundCredential(dataDir, "mock");
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
            dataDir,
            keychain,
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
