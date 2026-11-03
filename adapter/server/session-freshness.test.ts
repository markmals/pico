import type { McpServerStdio, NewSessionResponse } from "@agentclientprotocol/sdk";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent";

import { afterAll, describe, expect, test } from "bun:test";

import { connectPicoAgent } from "./agent-harness.ts";
import {
    mockEngine,
    removeTemporaryDirectories,
    temporaryDataDir,
    temporaryProject,
} from "./engine-harness.ts";

afterAll(removeTemporaryDirectories);

describe("proposal.0007 which sessions start from Pico's default", () => {
    test("session/new creates a fresh session, and load and resume reopen one", async () => {
        const dataDir = temporaryDataDir();
        const cwd = temporaryProject();
        const engine = await mockEngine([{ content: ["ok"] }]);
        const fresh: boolean[] = [];
        const createSession = (
            directory: string,
            servers: McpServerStdio[],
            manager: SessionManager,
            isFresh: boolean,
        ) => {
            fresh.push(isFresh);
            return engine.createSession(directory, servers, manager);
        };

        const first = connectPicoAgent({ version: "0.0.0-test", dataDir, createSession });
        await first.initialize();
        const created = (await first.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        await first.close();

        const second = connectPicoAgent({ version: "0.0.0-test", dataDir, createSession });
        try {
            await second.initialize();
            const reopen = { sessionId: created.sessionId, cwd, mcpServers: [] };
            await second.agent.request("session/load", reopen);
            await second.agent.request("session/resume", reopen);
        } finally {
            await second.close();
        }

        expect(fresh).toEqual([true, false, false]);
    });
});
