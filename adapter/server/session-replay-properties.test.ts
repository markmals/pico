import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { TestContext } from "node:test";

import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { picoWorkspace, useAsProcessAgentDir } from "../engine/testing/session-fixture.ts";
import { connectPicoAgent } from "./agent-harness.ts";
import { mockEngine, removeTemporaryDirectories } from "./engine-harness.ts";
import { picoAgentShutdown } from "./pico-agent.ts";

after(removeTemporaryDirectories);

const usage: AssistantMessage["usage"] = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
    content: AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "mock",
        provider: "mock",
        model: "mock-model",
        stopReason,
        usage,
        timestamp: 1,
    };
}

async function savedHistory(t: TestContext) {
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    useAsProcessAgentDir(t, agentDir);
    const manager = await SessionManager.inMemory(cwd).persistCopy({
        sessionDir: SessionManager.getDefaultSessionDir(cwd, dataDir),
        suppressBreadcrumb: true,
    });
    return { cwd, dataDir, manager };
}

describe("proposal.0004 replay invariants", () => {
    test("generated histories replay each selected call once and settle every outcome without model execution", async t => {
        const workspace = await savedHistory(t);
        for (let seed = 1; seed <= 12; seed++) {
            const { cwd, dataDir } = workspace;
            const manager =
                seed === 1
                    ? workspace.manager
                    : await SessionManager.inMemory(cwd).persistCopy({
                          sessionDir: SessionManager.getDefaultSessionDir(cwd, dataDir),
                          suppressBreadcrumb: true,
                      });
            const ids = Array.from(
                { length: 1 + (seed % 5) },
                (_, index) => `seed-${seed}-call-${index}`,
            );
            const missing = seed % 3 === 0 ? ids.at(-1) : undefined;
            manager.appendMessage({ role: "user", content: `visible-${seed}`, timestamp: 1 });
            manager.appendMessage(
                assistant(
                    [
                        { type: "thinking", thinking: `thought-${seed}` },
                        ...ids.map(id => ({
                            type: "toolCall" as const,
                            id,
                            name: "read",
                            arguments: { path: `${id}.txt` },
                        })),
                    ],
                    "toolUse",
                ),
            );
            for (const [index, id] of ids.entries()) {
                if (id === missing) continue;
                manager.appendMessage({
                    role: "toolResult",
                    toolCallId: id,
                    toolName: "read",
                    content: [{ type: "text", text: `result-${id}` }],
                    isError: index % 2 === 1,
                    timestamp: 2,
                });
            }
            if (!missing)
                manager.appendMessage(assistant([{ type: "text", text: `finished-${seed}` }]));
            const file = manager.getSessionFile()!;
            const sessionId = manager.getSessionId();
            await manager.close();
            const engine = await mockEngine([{ content: ["must not run during replay"] }]);
            const client = connectPicoAgent({
                version: "0.0.0-test",
                dataDir,
                createSession: engine.createSession,
            });
            try {
                await client.initialize();
                const loaded = await client.agent
                    .request("session/load", { sessionId, cwd, mcpServers: [] })
                    .then(
                        () => ({ error: null }),
                        (error: unknown) => ({
                            error: error instanceof Error ? error.message : String(error),
                        }),
                    );
                assert.equal(loaded.error, null, `seed ${seed}: ${loaded.error}`);
                const replay = client.updatesFor(sessionId);
                const opened = replay.filter(update => update.sessionUpdate === "tool_call");
                const closed = replay.filter(update => update.sessionUpdate === "tool_call_update");
                assert.deepEqual(
                    opened.map(update => update.toolCallId),
                    ids,
                    `seed ${seed}: unique starts`,
                );
                assert.deepEqual(
                    closed.map(update => update.toolCallId).toSorted(),
                    ids.toSorted(),
                    `seed ${seed}: unique terminals`,
                );
                for (const end of closed) {
                    const index = ids.indexOf(end.toolCallId);
                    assert.equal(
                        end.status,
                        end.toolCallId === missing || index % 2 === 1 ? "failed" : "completed",
                    );
                }
                if (missing)
                    assert.match(
                        JSON.stringify(closed.find(update => update.toolCallId === missing)),
                        /unknown/,
                    );
                assert.deepEqual(engine.model.calls, []);
                assert.ok(
                    replay.some(
                        update =>
                            update.sessionUpdate === "agent_thought_chunk" &&
                            update.content.type === "text" &&
                            update.content.text === `thought-${seed}`,
                    ),
                );
            } finally {
                await client.close();
                await picoAgentShutdown(client.app).completed;
            }
            const repaired = await SessionManager.open(file, undefined, undefined, {
                suppressBreadcrumb: true,
                throwIfMissing: true,
            });
            const results = repaired
                .getBranch()
                .filter(entry => entry.type === "message" && entry.message.role === "toolResult");
            assert.equal(results.length, ids.length, `seed ${seed}: durable repair`);
            await repaired.close();
        }
    });

    for (const savedStatus of ["completed", "failed"] as const) {
        test(`recovery overrides a ${savedStatus} presentation saved before the tool result`, async t => {
            const { cwd, dataDir, manager } = await savedHistory(t);
            manager.appendMessage({ role: "user", content: "run both commands", timestamp: 1 });
            manager.appendMessage(
                assistant(
                    ["pending-a", "finished-b"].map(id => ({
                        type: "toolCall",
                        id,
                        name: "bash",
                        arguments: { command: `echo ${id}` },
                    })),
                    "toolUse",
                ),
            );
            manager.appendCustomEntry("pico.tool-presentation", {
                version: 1,
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: "finished-b",
                    status: savedStatus,
                    content: [
                        {
                            type: "content",
                            content: { type: "text", text: "earlier presentation" },
                        },
                    ],
                },
            });
            const sessionId = manager.getSessionId();
            await manager.close();
            const engine = await mockEngine([{ content: ["must not run during recovery"] }]);
            const client = connectPicoAgent({
                version: "0.0.0-test",
                dataDir,
                createSession: engine.createSession,
            });
            try {
                await client.initialize();
                await client.agent.request("session/load", { sessionId, cwd, mcpServers: [] });
                const closed = client
                    .updatesFor(sessionId)
                    .filter(update => update.sessionUpdate === "tool_call_update");
                assert.deepEqual(
                    closed.map(update => [update.toolCallId, update.status]),
                    [
                        ["pending-a", "failed"],
                        ["finished-b", "failed"],
                    ],
                );
                for (const end of closed)
                    assert.match(JSON.stringify(end.content), /outcome is unknown/);
                assert.doesNotMatch(JSON.stringify(closed), /earlier presentation/);
                assert.deepEqual(engine.model.calls, []);
            } finally {
                await client.close();
                await picoAgentShutdown(client.app).completed;
            }
        });
    }

    test("a malformed Pico presentation record is rejected rather than trusted for replay", async t => {
        const { cwd, dataDir, manager } = await savedHistory(t);
        manager.appendMessage({ role: "user", content: "saved prompt", timestamp: 1 });
        manager.appendMessage(assistant([{ type: "text", text: "saved reply" }]));
        manager.appendCustomEntry("pico.tool-presentation", {
            version: 999,
            update: { sessionUpdate: "tool_call", toolCallId: "forged" },
        });
        const sessionId = manager.getSessionId();
        await manager.close();
        const engine = await mockEngine([{ content: ["must not run"] }]);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            dataDir,
            createSession: engine.createSession,
        });
        try {
            await client.initialize();
            const failure = await client.agent
                .request("session/load", { sessionId, cwd, mcpServers: [] })
                .then(
                    () => "unexpected success",
                    (error: unknown) => (error instanceof Error ? error.message : String(error)),
                );
            assert.match(failure, /Invalid or unsupported Pico tool presentation/);
            assert.deepEqual(client.updatesFor(sessionId), []);
        } finally {
            await client.close();
            await picoAgentShutdown(client.app).completed;
        }
    });
});
