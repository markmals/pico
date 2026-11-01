import type { McpServerStdio, SessionUpdate } from "@agentclientprotocol/sdk";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent";
import type { TestContext } from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PicoSession } from "../engine/pico-session.ts";
import type { TestProviderScripts } from "../engine/testing/test-provider.ts";
import type { ConnectedClient } from "./agent-harness.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import { exited, fakeMcpServer } from "../engine/testing/mcp-fixture.ts";
import {
    picoWorkspace,
    toolCall,
    unauthenticatedAuthStorage,
    useAsProcessAgentDir,
} from "../engine/testing/session-fixture.ts";
import { installTestProvider } from "../engine/testing/test-provider.ts";
import { assistantText, connectPicoAgent } from "./agent-harness.ts";
import { picoAgentShutdown } from "./pico-agent.ts";
import { isRunning } from "./session-fixture.ts";

async function fixture(t: TestContext, scripts: TestProviderScripts = {}) {
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    useAsProcessAgentDir(t, agentDir);
    const models = installTestProvider(cwd, scripts);
    const authStorage = await unauthenticatedAuthStorage(agentDir);
    const connections: ConnectedClient[] = [];
    const engines: PicoSession[] = [];
    const creation: { before?: () => Promise<void> } = {};
    const connect = async () => {
        const client = connectPicoAgent({
            version: "0.0.0-test",
            dataDir,
            createSession: async (
                directory: string,
                mcpServers: McpServerStdio[],
                sessionManager: SessionManager,
            ) => {
                await creation.before?.();
                const session = await createPicoSession({
                    cwd: directory,
                    agentDir,
                    dataDir,
                    authStorage,
                    mcpServers,
                    sessionManager,
                });
                engines.push(session);
                return session;
            },
        });
        connections.push(client);
        await client.initialize();
        return client;
    };
    t.after(async () => {
        for (const client of connections) await disconnect(client);
        authStorage.close();
    });
    return { cwd, dataDir, agentDir, models, engines, connect, creation };
}

async function disconnect(client: ConnectedClient): Promise<void> {
    await client.close();
    await picoAgentShutdown(client.app).completed;
}

async function outcome<T>(pending: Promise<T>): Promise<T | { error: string }> {
    return pending.catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
    }));
}

function prompt(client: ConnectedClient, sessionId: string, text: string) {
    return client.agent.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
    });
}

function texts(updates: SessionUpdate[], kind: "user_message_chunk" | "agent_message_chunk") {
    return updates.flatMap(update =>
        update.sessionUpdate === kind && update.content.type === "text"
            ? [update.content.text]
            : [],
    );
}

describe("proposal.0004 agent continuation", () => {
    test("an empty returned session is discoverable after its connection closes", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const created = await first.agent.request("session/new", { cwd: f.cwd, mcpServers: [] });
        await disconnect(first);

        const second = await f.connect();
        const listed = await outcome(second.agent.request("session/list", {}));
        assert.ok(!("error" in listed), JSON.stringify(listed));
        assert.deepEqual(
            listed.sessions.map(session => ({ sessionId: session.sessionId, cwd: session.cwd })),
            [{ sessionId: created.sessionId, cwd: fs.realpathSync(f.cwd) }],
        );
    });

    test("resume restores context and session-local selectors without replay or default writes", async t => {
        const f = await fixture(t);
        const configPath = path.join(f.cwd, ".omp", "config.yml");
        const config = fs.readFileSync(configPath, "utf8");
        const first = await f.connect();
        const { sessionId } = await first.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        await prompt(first, sessionId, "The recovery word is copper-kingfisher.");
        await first.agent.request("session/set_config_option", {
            sessionId,
            configId: "model",
            value: "pico-test/beta",
        });
        await first.agent.request("session/set_config_option", {
            sessionId,
            configId: "thinking",
            value: "high",
        });
        await disconnect(first);

        const second = await f.connect();
        const resumed = await outcome(
            second.agent.request("session/resume", { sessionId, cwd: f.cwd }),
        );
        assert.ok(!("error" in resumed), JSON.stringify(resumed));
        assert.equal(
            resumed.configOptions?.find(option => option.id === "model")?.currentValue,
            "pico-test/beta",
        );
        assert.equal(
            resumed.configOptions?.find(option => option.id === "thinking")?.currentValue,
            "high",
        );
        assert.deepEqual(second.updatesFor(sessionId), []);
        await prompt(second, sessionId, "What was the recovery word?");
        const received = JSON.stringify(f.models.beta.calls.at(-1)?.context.messages);
        assert.match(received, /copper-kingfisher/);
        assert.match(received, /from alpha/);
        assert.match(assistantText(second.updatesFor(sessionId)), /from beta/);
        assert.equal(f.models.beta.calls.at(-1)?.options?.reasoning, "high");
        assert.equal(fs.readFileSync(configPath, "utf8"), config);
        assert.equal(fs.existsSync(path.join(f.agentDir, "config.yml")), false);
    });

    test("load replays one card per call and its historical diff without running tools again", async t => {
        const f = await fixture(t, {
            alpha: {
                responses: [
                    {
                        content: [
                            "Changing the note.",
                            toolCall(
                                "write",
                                { path: "note.txt", content: "saved\n" },
                                "saved-write",
                            ),
                        ],
                    },
                    { content: [toolCall("bash", { command: "exit 7" }, "saved-error")] },
                    { content: ["The saved turn is finished."] },
                ],
            },
        });
        const file = path.join(f.cwd, "note.txt");
        fs.writeFileSync(file, "before\n");
        const first = await f.connect();
        const { sessionId } = await first.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        await prompt(first, sessionId, "Save the note, then demonstrate a failing command.");
        await disconnect(first);
        const callsBeforeLoad = f.models.alpha.calls.length;
        fs.writeFileSync(file, "changed after the original turn\n");

        const second = await f.connect();
        const loaded = await outcome(
            second.agent.request("session/load", {
                sessionId,
                cwd: f.cwd,
                mcpServers: [],
            }),
        );
        assert.ok(!("error" in loaded), JSON.stringify(loaded));
        const replay = second.updatesFor(sessionId);
        assert.deepEqual(texts(replay, "user_message_chunk"), [
            "Save the note, then demonstrate a failing command.",
        ]);
        assert.equal(
            texts(replay, "agent_message_chunk").join(""),
            "Changing the note.The saved turn is finished.",
        );
        const starts = replay.filter(update => update.sessionUpdate === "tool_call");
        assert.deepEqual(
            starts.map(update => update.toolCallId),
            ["saved-write", "saved-error"],
        );
        const ends = replay.filter(update => update.sessionUpdate === "tool_call_update");
        assert.deepEqual(
            ends.map(update => [update.toolCallId, update.status]),
            [
                ["saved-write", "completed"],
                ["saved-error", "failed"],
            ],
        );
        assert.ok(
            ends[0]?.content?.some(
                content =>
                    content.type === "diff" &&
                    content.oldText === "before\n" &&
                    content.newText === "saved\n",
            ),
        );
        assert.match(JSON.stringify(ends[1]?.content), /code 7/);
        assert.equal(fs.readFileSync(file, "utf8"), "changed after the original turn\n");
        assert.equal(f.models.alpha.calls.length, callsBeforeLoad);
    });

    test("load retains the full selected transcript rather than compacted model context", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const { sessionId } = await first.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        await prompt(first, sessionId, "An earlier visible message.");
        await prompt(first, sessionId, "The retained tail.");
        const manager = f.engines[0]!.engine.sessionManager;
        const tail = manager
            .getBranch()
            .find(
                entry =>
                    entry.type === "message" &&
                    entry.message.role === "user" &&
                    JSON.stringify(entry.message.content).includes("The retained tail."),
            );
        assert.ok(tail);
        manager.appendCompaction(
            "Do not replay this summary as a duplicate answer.",
            undefined,
            tail.id,
            100,
        );
        await manager.flush();
        await disconnect(first);

        const second = await f.connect();
        const loaded = await outcome(
            second.agent.request("session/load", { sessionId, cwd: f.cwd, mcpServers: [] }),
        );
        assert.ok(!("error" in loaded), JSON.stringify(loaded));
        const replay = second.updatesFor(sessionId);
        assert.deepEqual(texts(replay, "user_message_chunk"), [
            "An earlier visible message.",
            "The retained tail.",
        ]);
        assert.deepEqual(texts(replay, "agent_message_chunk"), ["from alpha", "from alpha"]);
        assert.doesNotMatch(JSON.stringify(replay), /Do not replay this summary/);
    });

    for (const method of ["session/load", "session/resume"] as const) {
        test(`${method} finishing after disconnect releases its server and writer for another connection`, async t => {
            const f = await fixture(t);
            const first = await f.connect();
            const { sessionId } = await first.agent.request("session/new", {
                cwd: f.cwd,
                mcpServers: [],
            });
            await prompt(first, sessionId, "Retain this conversation through a failed attachment.");
            await disconnect(first);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            f.creation.before = async () => {
                entered.resolve();
                await release.promise;
            };
            const second = await f.connect();
            const pidFile = path.join(f.cwd, "restored-mcp.pid");
            const pending = outcome(
                second.agent.request(method, {
                    sessionId,
                    cwd: f.cwd,
                    mcpServers: [fakeMcpServer("restored", { flags: ["--pid-file", pidFile] })],
                }),
            );
            try {
                const started = await Promise.race([
                    entered.promise.then(() => true),
                    pending.then(() => false),
                ]);
                assert.equal(started, true, "restoration never reached engine construction");
                await second.close();
                f.creation.before = undefined;
                release.resolve();
                await pending;
                await picoAgentShutdown(second.app).completed;
                const pid = Number(fs.readFileSync(pidFile, "utf8"));
                assert.equal(await exited(pid), true, "restoration left its MCP process alive");
                const third = await f.connect();
                const resumed = await outcome(
                    third.agent.request("session/resume", { sessionId, cwd: f.cwd }),
                );
                assert.ok(!("error" in resumed), JSON.stringify(resumed));
                await prompt(third, sessionId, "Continue the original conversation.");
                assert.match(
                    JSON.stringify(f.models.alpha.calls.at(-1)?.context.messages),
                    /Retain this conversation/,
                );
            } finally {
                f.creation.before = undefined;
                release.resolve();
            }
        });
    }

    test("the client sees the same thinking choice after reopen, including a non-reasoning clamp", async t => {
        const f = await fixture(t);
        const cases = [
            { model: "beta", thinking: "off" },
            { model: "beta", thinking: "low" },
            { model: "beta", thinking: "medium" },
            { model: "beta", thinking: "high" },
            { model: "beta", thinking: "auto" },
            { model: "alpha", thinking: "high" },
        ] as const;
        for (const { model, thinking } of cases) {
            const first = await f.connect();
            const { sessionId } = await first.agent.request("session/new", {
                cwd: f.cwd,
                mcpServers: [],
            });
            await first.agent.request("session/set_config_option", {
                sessionId,
                configId: "model",
                value: "pico-test/beta",
            });
            await first.agent.request("session/set_config_option", {
                sessionId,
                configId: "thinking",
                value: thinking,
            });
            if (model === "alpha") {
                await first.agent.request("session/set_config_option", {
                    sessionId,
                    configId: "model",
                    value: "pico-test/alpha",
                });
            }
            await disconnect(first);
            const second = await f.connect();
            const resumed = await second.agent.request("session/resume", { sessionId, cwd: f.cwd });
            assert.equal(
                resumed.configOptions?.find(option => option.id === "model")?.currentValue,
                `pico-test/${model}`,
            );
            assert.equal(
                resumed.configOptions?.find(option => option.id === "thinking")?.currentValue,
                model === "alpha" ? "off" : thinking,
            );
            await prompt(second, sessionId, "Answer on the model this session selected.");
            assert.equal(assistantText(second.updatesFor(sessionId)), `from ${model}`);
            await disconnect(second);
        }
    });

    for (const method of ["session/load", "session/resume"] as const) {
        test(`idle ${method} replaces its attachment without duplicating context or keeping old MCP servers`, async t => {
            const f = await fixture(t);
            const client = await f.connect();
            const oldPidFile = path.join(f.cwd, "initial-server.pid");
            const newPidFile = path.join(f.cwd, "replacement-server.pid");
            const { sessionId } = await client.agent.request("session/new", {
                cwd: f.cwd,
                mcpServers: [fakeMcpServer("initial", { flags: ["--pid-file", oldPidFile] })],
            });
            let previousPid = Number(fs.readFileSync(oldPidFile, "utf8"));
            const invalid = await outcome(
                client.agent.request(method, {
                    sessionId,
                    cwd: f.dataDir,
                    mcpServers: [],
                }),
            );
            assert.ok("error" in invalid);
            assert.equal(
                isRunning(previousPid),
                true,
                "invalid replacement destroyed the active server",
            );
            await prompt(client, sessionId, "Remember the word persimmon.");
            const modelCalls = f.models.alpha.calls.length;
            for (let attempt = 0; attempt < 2; attempt++) {
                const before = client.updatesFor(sessionId).length;
                const omitServers = method === "session/resume" && attempt === 1;
                const requested = omitServers
                    ? client.agent.request("session/resume", { sessionId, cwd: f.cwd })
                    : client.agent.request(method, {
                          sessionId,
                          cwd: f.cwd,
                          mcpServers: [
                              fakeMcpServer("replacement", { flags: ["--pid-file", newPidFile] }),
                          ],
                      });
                const restored = await outcome(requested);
                assert.ok(!("error" in restored), JSON.stringify(restored));
                assert.equal(await exited(previousPid), true, "the replaced MCP server survived");
                const replay = client.updatesFor(sessionId).slice(before);
                if (method === "session/load") {
                    assert.deepEqual(texts(replay, "user_message_chunk"), [
                        "Remember the word persimmon.",
                    ]);
                    assert.deepEqual(texts(replay, "agent_message_chunk"), ["from alpha"]);
                } else {
                    assert.deepEqual(replay, []);
                }
                const session = f.engines.at(-1)!;
                const servers = new Set(
                    session.engine.getActiveToolNames().flatMap(name => {
                        const identity = session.mcpToolIdentity(name);
                        return identity ? [identity.server] : [];
                    }),
                );
                assert.deepEqual([...servers], omitServers ? [] : ["replacement"]);
                assert.equal(session.engine.sessionManager.getSessionId(), sessionId);
                assert.equal(
                    f.models.alpha.calls.length,
                    modelCalls,
                    "reattachment invoked the model",
                );
                if (!omitServers) previousPid = Number(fs.readFileSync(newPidFile, "utf8"));
            }
            await prompt(client, sessionId, "What did this conversation remember?");
            const context = JSON.stringify(f.models.alpha.calls.at(-1)?.context.messages);
            assert.equal(context.match(/Remember the word persimmon/g)?.length, 1);
        });
    }

    test("loading a running session is refused without cancelling its turn", async t => {
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const f = await fixture(t, {
            alpha: {
                handler: async () => {
                    started.resolve();
                    await finish.promise;
                    return { content: ["The original turn finished."] };
                },
            },
        });
        const client = await f.connect();
        const { sessionId } = await client.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        const turn = outcome(prompt(client, sessionId, "Keep this turn running."));
        try {
            await started.promise;
            const refused = await outcome(
                client.agent.request("session/load", { sessionId, cwd: f.cwd, mcpServers: [] }),
            );
            assert.ok("error" in refused);
            assert.match(refused.error, /busy|running|already/i);
        } finally {
            finish.resolve();
        }
        const completed = await turn;
        assert.ok(!("error" in completed), JSON.stringify(completed));
        assert.equal(completed.stopReason, "end_turn");
        assert.equal(assistantText(client.updatesFor(sessionId)), "The original turn finished.");
    });

    test("resuming during a model change is refused without destroying that change", async t => {
        const f = await fixture(t);
        const client = await f.connect();
        const { sessionId } = await client.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        const session = f.engines[0]!;
        const originalSelect = session.selectModel.bind(session);
        const changing = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        session.selectModel = async model => {
            changing.resolve();
            await finish.promise;
            await originalSelect(model);
        };
        const pending = outcome(
            client.agent.request("session/set_config_option", {
                sessionId,
                configId: "model",
                value: "pico-test/beta",
            }),
        );
        try {
            await changing.promise;
            const refused = await outcome(
                client.agent.request("session/resume", { sessionId, cwd: f.cwd }),
            );
            assert.ok("error" in refused);
            assert.match(refused.error, /busy|changing|already/i);
        } finally {
            finish.resolve();
        }
        const changed = await pending;
        assert.ok(!("error" in changed), JSON.stringify(changed));
        assert.equal(
            changed.configOptions.find(option => option.id === "model")?.currentValue,
            "pico-test/beta",
        );
        await prompt(client, sessionId, "Answer on the model I selected.");
        assert.equal(assistantText(client.updatesFor(sessionId)), "from beta");
    });

    test("an in-flight reattachment reserves its identifier until it becomes ready", async t => {
        const f = await fixture(t);
        const client = await f.connect();
        const { sessionId } = await client.agent.request("session/new", {
            cwd: f.cwd,
            mcpServers: [],
        });
        await prompt(client, sessionId, "Keep one authoritative continuation.");
        const entered = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        f.creation.before = async () => {
            entered.resolve();
            await finish.promise;
        };
        const pending = outcome(client.agent.request("session/resume", { sessionId, cwd: f.cwd }));
        try {
            const started = await Promise.race([
                entered.promise.then(() => true),
                pending.then(() => false),
            ]);
            assert.equal(started, true, "idle replacement never reached construction");
            const second = await outcome(
                client.agent.request("session/load", { sessionId, cwd: f.cwd, mcpServers: [] }),
            );
            assert.ok("error" in second);
            assert.match(second.error, /busy|already|starting|replaying/i);
        } finally {
            f.creation.before = undefined;
            finish.resolve();
        }
        const completed = await pending;
        assert.ok(!("error" in completed), JSON.stringify(completed));
        await prompt(client, sessionId, "Continue after replacement.");
        assert.match(
            JSON.stringify(f.models.alpha.calls.at(-1)?.context.messages),
            /one authoritative continuation/,
        );
    });
});
