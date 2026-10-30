import type { NewSessionResponse } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DisposalPhase, PicoSession } from "../engine/pico-session.ts";

import { connectPicoAgent } from "./agent-harness.ts";
import { mockEngine, removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { fakeSession, neverSettles } from "./fake-session.ts";
import { picoAgentShutdown } from "./pico-agent.ts";
import {
    closeOpenConnections,
    isRunning,
    settle,
    startPicoSession,
    waitUntil,
} from "./session-fixture.ts";

const STUB_MCP_SERVER = join(import.meta.dir, "stub-mcp-server.fixture.ts");

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

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
                    get disposalPhase() {
                        return session.disposalPhase;
                    },
                    takeChanges: toolCallId => session.takeChanges(toolCallId),
                    writesSettled: () => session.writesSettled(),
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
        await picoAgentShutdown(client.app).completed;

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
        await picoAgentShutdown(session.client.app).completed;

        expect(await waitUntil(() => !isRunning(pid))).toBe(true);
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
        await picoAgentShutdown(client.app).completed;

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

    test("a session already running is stopped without waiting for one still starting", async () => {
        const started = Promise.withResolvers<void>();
        const creatingSecond = Promise.withResolvers<void>();
        const heldCreation = Promise.withResolvers<void>();
        const running = fakeSession(temporaryProject(), {
            prompt: () => {
                started.resolve();
                return neverSettles<boolean>();
            },
            abort: () => Promise.resolve(),
        });
        const starting = fakeSession(temporaryProject());
        let creations = 0;
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: async () => {
                creations++;
                if (creations === 1) return running.session;
                creatingSecond.resolve();
                await heldCreation.promise;
                return starting.session;
            },
        });
        await client.initialize();
        const first = (await client.agent.request("session/new", {
            cwd: running.session.cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        const turn = client.agent.request("session/prompt", {
            sessionId: first.sessionId,
            prompt: [{ type: "text", text: "hang" }],
        });
        await started.promise;
        const second = client.agent.request("session/new", {
            cwd: starting.session.cwd,
            mcpServers: [],
        });
        await creatingSecond.promise;

        await client.close();

        // The held creation never finishes: the session already running must not wait
        // behind it to have its turn stopped and its MCP servers disconnected.
        expect(await waitUntil(() => running.calls.includes("dispose"), 5_000)).toBe(true);
        expect(running.calls).toEqual(["prompt", "abort", "dispose"]);

        heldCreation.resolve();
        await second.catch(() => undefined);
        await turn.catch(() => undefined);
    }, 20_000);

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
        await picoAgentShutdown(client.app).completed;
        await running.catch(() => undefined);

        expect(fake.calls).toEqual(["prompt", "abort", "dispose"]);
    });

    test.each<DisposalPhase>(["disconnecting MCP servers", "disposing the engine"])(
        "a teardown stalled on %s is named as outstanding",
        async phase => {
            const cwd = temporaryProject();
            const fake = fakeSession(cwd, {
                dispose: () => neverSettles<void>(),
                disposalPhase: phase,
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

            await client.close();
            const shutdown = picoAgentShutdown(client.app);
            await settle();

            expect(shutdown.outstanding()).toEqual([`session ${created.sessionId}: ${phase}`]);
        },
    );

    test("a teardown that reports no step is still named as outstanding", async () => {
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
