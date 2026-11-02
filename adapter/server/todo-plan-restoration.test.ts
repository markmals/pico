import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { TodoPhase } from "@oh-my-pi/pi-coding-agent/tools";
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

function toolUse(calls: { id: string; name: string }[]): AssistantMessage {
    return {
        role: "assistant",
        content: calls.map(call => ({
            type: "toolCall" as const,
            id: call.id,
            name: call.name,
            arguments: call.name === "todo" ? { op: "init", items: ["x"] } : { path: "a.txt" },
        })),
        api: "mock",
        provider: "mock",
        model: "mock-model",
        stopReason: "toolUse",
        usage,
        timestamp: 1,
    };
}

/** A 32-bit xorshift, deterministic per seed. */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

const PLAIN_STATUSES = ["pending", "in_progress", "completed"] as const;

function randomList(next: (bound: number) => number, label: string): TodoPhase[] {
    return [
        {
            name: `Phase ${label}`,
            tasks: Array.from({ length: 1 + next(3) }, (_task, index) => ({
                content: `${label} task ${index}`,
                status: PLAIN_STATUSES[next(PLAIN_STATUSES.length)]!,
            })),
        },
    ];
}

/** The plan entries a list of plain (never abandoned or blocked) items becomes. */
function expectedEntries(phases: TodoPhase[]): [string, string][] {
    return phases.flatMap(phase =>
        phase.tasks.map((task): [string, string] => [task.content, task.status]),
    );
}

function plans(updates: SessionUpdate[]): [string, string][][] {
    return updates.flatMap(update =>
        update.sessionUpdate === "plan"
            ? [update.entries.map((entry): [string, string] => [entry.content, entry.status])]
            : [],
    );
}

async function savedHistory(t: TestContext) {
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    useAsProcessAgentDir(t, agentDir);
    const create = () =>
        SessionManager.inMemory(cwd).persistCopy({
            sessionDir: SessionManager.getDefaultSessionDir(cwd, dataDir),
            suppressBreadcrumb: true,
        });
    return { cwd, dataDir, create };
}

async function reopen(
    history: { cwd: string; dataDir: string },
    manager: SessionManager,
    method: "session/load" | "session/resume",
): Promise<SessionUpdate[]> {
    const sessionId = manager.getSessionId();
    await manager.close();
    const engine = await mockEngine([{ content: ["must not run while reopening"] }]);
    const client = connectPicoAgent({
        version: "0.0.0-test",
        dataDir: history.dataDir,
        createSession: engine.createSession,
    });
    try {
        await client.initialize();
        await client.agent.request(method, { sessionId, cwd: history.cwd, mcpServers: [] });
        assert.deepEqual(engine.model.calls, []);
        return client.updatesFor(sessionId);
    } finally {
        await client.close();
        await picoAgentShutdown(client.app).completed;
    }
}

describe("proposal.0006 the plan when a session reopens", () => {
    test("for any saved history, load replays no successful todo call and no old plan, then sends the current list once", async t => {
        const history = await savedHistory(t);
        const seen = { succeeded: 0, failed: 0, missing: 0, emptyPlans: 0 };
        for (let seed = 1; seed <= 10; seed++) {
            const next = randomSource(seed);
            const manager = await history.create();
            const calls = Array.from({ length: 2 + next(4) }, (_call, index) => ({
                id: `seed-${seed}-call-${index}`,
                name: next(3) === 0 ? "read" : "todo",
            }));
            const missing = next(2) === 0 ? calls.at(-1)?.id : undefined;
            const outcomes = new Map<string, "succeeded" | "failed" | "missing">();
            let current: TodoPhase[] = [];
            manager.appendMessage({ role: "user", content: `request ${seed}`, timestamp: 1 });
            manager.appendMessage(toolUse(calls));
            for (const call of calls) {
                if (call.id === missing) {
                    outcomes.set(call.id, "missing");
                    continue;
                }
                const failed = next(3) === 0;
                outcomes.set(call.id, failed ? "failed" : "succeeded");
                const list = randomList(next, call.id);
                if (call.name === "todo" && !failed) current = list;
                manager.appendMessage({
                    role: "toolResult",
                    toolCallId: call.id,
                    toolName: call.name,
                    content: [{ type: "text", text: `result ${call.id}` }],
                    details: { op: "init", phases: list, storage: "session" },
                    isError: failed,
                    timestamp: 2,
                });
            }

            const updates = await reopen(history, manager, "session/load");

            const context = `seed ${seed}`;
            for (const call of calls) {
                const outcome = outcomes.get(call.id)!;
                if (call.name === "todo") seen[outcome]++;
                const about = updates.filter(
                    update =>
                        (update.sessionUpdate === "tool_call" ||
                            update.sessionUpdate === "tool_call_update") &&
                        update.toolCallId === call.id,
                );
                if (call.name === "todo" && outcome === "succeeded") {
                    assert.deepEqual(about, [], `${context}: ${call.id} was replayed`);
                    continue;
                }
                assert.deepEqual(
                    about.map(update => update.sessionUpdate),
                    ["tool_call", "tool_call_update"],
                    `${context}: ${call.id}`,
                );
            }
            assert.deepEqual(plans(updates), [expectedEntries(current)], context);
            assert.equal(updates.at(-1)?.sessionUpdate, "plan", `${context}: plan comes last`);
            if (current.length === 0) seen.emptyPlans++;
        }
        assert.ok(seen.succeeded > 0, "generated successful todo calls");
        assert.ok(seen.failed > 0, "generated failed todo calls");
        assert.ok(seen.missing > 0, "generated interrupted todo calls");
        assert.ok(seen.emptyPlans > 0, "generated histories with no current list");
    });

    test("resume replays nothing and sends the current list once", async t => {
        const history = await savedHistory(t);
        const manager = await history.create();
        manager.appendMessage({ role: "user", content: "plan it", timestamp: 1 });
        manager.appendMessage(toolUse([{ id: "todo-1", name: "todo" }]));
        manager.appendMessage({
            role: "toolResult",
            toolCallId: "todo-1",
            toolName: "todo",
            content: [{ type: "text", text: "Overall: 0/1 done" }],
            details: {
                op: "init",
                phases: [{ name: "Tasks", tasks: [{ content: "Kept", status: "in_progress" }] }],
                storage: "session",
            },
            isError: false,
            timestamp: 2,
        });

        const updates = await reopen(history, manager, "session/resume");

        assert.deepEqual(updates, [
            {
                sessionUpdate: "plan",
                entries: [{ content: "Kept", priority: "medium", status: "in_progress" }],
            },
        ]);
    });

    test("a session that never had a list reopens with an empty plan", async t => {
        const history = await savedHistory(t);
        const manager = await history.create();
        manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });

        const updates = await reopen(history, manager, "session/resume");

        assert.deepEqual(updates, [{ sessionUpdate: "plan", entries: [] }]);
    });
});
