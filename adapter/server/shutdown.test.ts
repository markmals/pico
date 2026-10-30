import type { NewSessionResponse } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";

import { connectPicoAgent } from "./agent-harness.ts";
import { mockEngine, removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { fakeSession, neverSettles } from "./fake-session.ts";
import { picoAgentShutdown } from "./pico-agent.ts";
import { closeOpenConnections, settle, startPicoSession } from "./session-fixture.ts";

const STUB_MCP_SERVER = join(import.meta.dir, "stub-mcp-server.fixture.ts");

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe("proposal.0001 shutdown", () => {
    test("closing the connection disposes every session on it", async () => {
        const engine = await mockEngine([{ content: ["ok"] }]);
        const disposed: string[] = [];
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: async (cwd, mcpServers): Promise<PicoSession> => {
                const session = await engine.createSession(cwd, mcpServers);
                return {
                    engine: session.engine,
                    cwd: session.cwd,
                    takeRecordedChanges: toolCallId => session.takeRecordedChanges(toolCallId),
                    mcpToolIdentity: toolName => session.mcpToolIdentity(toolName),
                    dispose: async () => {
                        disposed.push(session.cwd);
                        await session.dispose();
                    },
                };
            },
        });
        await client.initialize();
        const first = temporaryProject();
        const second = temporaryProject();
        await client.agent.request("session/new", { cwd: first, mcpServers: [] });
        await client.agent.request("session/new", { cwd: second, mcpServers: [] });

        await client.close();
        await settle();

        expect(disposed.toSorted()).toEqual([first, second].toSorted());
    });

    test("closing the connection terminates the MCP servers a session started", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "mcp-server.pid");
        const session = await startPicoSession([{ content: ["ok"] }], {
            cwd,
            mcpServers: [
                {
                    name: "stub",
                    command: process.execPath,
                    args: [STUB_MCP_SERVER, pidFile],
                    env: [],
                },
            ],
        });
        const pid = Number(readFileSync(pidFile, "utf8"));
        expect(isRunning(pid)).toBe(true);

        await session.client.close();
        await settle(1_000);

        expect(isRunning(pid)).toBe(false);
    }, 20_000);

    test("a session that finishes being created after the connection closed is disposed", async () => {
        const cwd = temporaryProject();
        const creating = Promise.withResolvers<void>();
        const creation = Promise.withResolvers<void>();
        const fake = fakeSession(cwd);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: async () => {
                creating.resolve();
                await creation.promise;
                return fake.session;
            },
        });
        await client.initialize();

        const pending = client.agent.request("session/new", { cwd, mcpServers: [] });
        await creating.promise;
        await client.close();
        creation.resolve();
        await pending.catch(() => undefined);
        await settle();

        expect(fake.disposals).toBe(1);
    });

    test("shutdown does not resolve while a session is still being created", async () => {
        const cwd = temporaryProject();
        const creating = Promise.withResolvers<void>();
        const creation = Promise.withResolvers<void>();
        const fake = fakeSession(cwd);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: async () => {
                creating.resolve();
                await creation.promise;
                return fake.session;
            },
        });
        await client.initialize();

        const pending = client.agent.request("session/new", { cwd, mcpServers: [] });
        await creating.promise;
        await client.close();
        const shutdown = picoAgentShutdown(client.app);
        creation.resolve();
        await shutdown.completed;

        expect(fake.disposals).toBe(1);
        await pending.catch(() => undefined);
    });

    test("a running turn is stopped before its session's MCP servers are disconnected", async () => {
        const cwd = temporaryProject();
        const started = Promise.withResolvers<void>();
        const fake = fakeSession(cwd, {
            prompt: () => {
                started.resolve();
                return neverSettles<boolean>();
            },
            abort: () => Promise.resolve(),
        });
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(fake.session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;

        const running = client.agent.request("session/prompt", {
            sessionId: created.sessionId,
            prompt: [{ type: "text", text: "hang" }],
        });
        await started.promise;
        await client.close();
        await settle();
        await running.catch(() => undefined);

        expect(fake.calls).toEqual(["prompt", "abort", "dispose"]);
    });

    test("a stalled session teardown is named as outstanding", async () => {
        const cwd = temporaryProject();
        const fake = fakeSession(cwd, { dispose: () => neverSettles<void>() });
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(fake.session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;

        await client.close();
        const shutdown = picoAgentShutdown(client.app);
        await settle();

        expect(shutdown.outstanding()).toEqual([
            `disposing session ${created.sessionId} and the MCP servers it started`,
        ]);
    });

    test("a turn that will not stop is named as outstanding", async () => {
        const cwd = temporaryProject();
        const started = Promise.withResolvers<void>();
        const fake = fakeSession(cwd, {
            prompt: () => {
                started.resolve();
                return neverSettles<boolean>();
            },
        });
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(fake.session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        const running = client.agent.request("session/prompt", {
            sessionId: created.sessionId,
            prompt: [{ type: "text", text: "hang" }],
        });

        await started.promise;
        await client.close();
        const shutdown = picoAgentShutdown(client.app);
        await settle();

        expect(shutdown.outstanding()).toEqual([
            `stopping the turn running in session ${created.sessionId}`,
        ]);
        await running.catch(() => undefined);
    });

    test("nothing is outstanding once shutdown has finished", async () => {
        const cwd = temporaryProject();
        const fake = fakeSession(cwd);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(fake.session),
        });
        await client.initialize();
        await client.agent.request("session/new", { cwd, mcpServers: [] });

        await client.close();
        const shutdown = picoAgentShutdown(client.app);
        await shutdown.completed;

        expect(shutdown.outstanding()).toEqual([]);
    });
});
