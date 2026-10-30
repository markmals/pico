import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

import { describe, expect, test } from "bun:test";

import {
    toolExecutionEnd,
    toolExecutionStart,
    toolExecutionUpdate,
    toolResult,
} from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

const TOOL_CALL_IDS = ["call-1", "call-2", "call-3"];
const TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "mcp__sesh_notify"];

/** Deterministic generator so a failing sequence is reproducible from its seed. */
function randomSequence(seed: number): AgentSessionEvent[] {
    let state = seed;
    const next = (bound: number) => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state % bound;
    };

    const events: AgentSessionEvent[] = [];
    const length = 1 + next(12);
    for (let index = 0; index < length; index++) {
        const toolCallId = TOOL_CALL_IDS[next(TOOL_CALL_IDS.length)] as string;
        const toolName = TOOL_NAMES[next(TOOL_NAMES.length)] as string;
        switch (next(4)) {
            case 0:
                events.push(toolExecutionStart({ toolCallId, toolName, args: { path: "a.txt" } }));
                break;
            case 1:
                events.push(
                    toolExecutionUpdate({
                        toolCallId,
                        toolName,
                        partialResult: toolResult("working"),
                    }),
                );
                break;
            case 2:
                events.push(toolExecutionEnd({ toolCallId, toolName, result: toolResult("done") }));
                break;
            default:
                events.push(
                    toolExecutionEnd({
                        toolCallId,
                        toolName,
                        result: toolResult("failed"),
                        isError: true,
                    }),
                );
        }
    }
    return events;
}

function toolCallIdOf(update: SessionUpdate): string | undefined {
    return update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update"
        ? update.toolCallId
        : undefined;
}

describe("proposal.0001 tool call reporting invariants", () => {
    test("for any engine sequence every started call is opened once, in order, and settles once", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const mapper = new SessionEventMapper({
                cwd: "/workspace",
                takeRecordedChanges: () => [],
                mcpToolIdentity: () => undefined,
            });
            const events = randomSequence(seed);
            const updates = events.flatMap(event => mapper.map(event));
            updates.push(...mapper.closeOpenToolCalls());

            const byToolCallId = new Map<string, SessionUpdate[]>();
            for (const update of updates) {
                const toolCallId = toolCallIdOf(update);
                if (toolCallId === undefined) continue;
                const existing = byToolCallId.get(toolCallId);
                if (existing) existing.push(update);
                else byToolCallId.set(toolCallId, [update]);
            }

            // Every call the engine started must be reported, and nothing else may be.
            const started = new Set(
                events
                    .filter(event => event.type === "tool_execution_start")
                    .map(event => event.toolCallId),
            );
            expect([...byToolCallId.keys()].toSorted(), `seed ${seed}: reported calls`).toEqual(
                [...started].toSorted(),
            );

            for (const toolCallId of started) {
                const context = `seed ${seed}, tool call ${toolCallId}`;
                const group = byToolCallId.get(toolCallId) ?? [];
                const opens = group.filter(update => update.sessionUpdate === "tool_call");
                expect(opens.length, `${context}: tool_call count`).toBe(1);
                expect(group[0]?.sessionUpdate, `${context}: first update`).toBe("tool_call");

                const terminals = group.filter(
                    update =>
                        update.sessionUpdate === "tool_call_update" &&
                        (update.status === "completed" || update.status === "failed"),
                );
                expect(terminals.length, `${context}: terminal status count`).toBe(1);
            }
        }
    });

    test("closing open tool calls fails only the calls still running", () => {
        const mapper = new SessionEventMapper({
            cwd: "/workspace",
            takeRecordedChanges: () => [],
            mcpToolIdentity: () => undefined,
        });
        mapper.map(
            toolExecutionStart({ toolCallId: "done-1", toolName: "read", args: { path: "a.txt" } }),
        );
        mapper.map(
            toolExecutionEnd({ toolCallId: "done-1", toolName: "read", result: toolResult("a") }),
        );
        mapper.map(
            toolExecutionStart({
                toolCallId: "running-1",
                toolName: "bash",
                args: { command: "sleep 30" },
            }),
        );

        const closing = mapper.closeOpenToolCalls();

        expect(closing).toEqual([
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "running-1",
                status: "failed",
                content: [{ type: "content", content: { type: "text", text: "Cancelled" } }],
            },
        ]);
    });

    test("closing open tool calls twice reports nothing the second time", () => {
        const mapper = new SessionEventMapper({
            cwd: "/workspace",
            takeRecordedChanges: () => [],
            mcpToolIdentity: () => undefined,
        });
        mapper.map(
            toolExecutionStart({
                toolCallId: "running-1",
                toolName: "bash",
                args: { command: "sleep 30" },
            }),
        );
        mapper.closeOpenToolCalls();

        expect(mapper.closeOpenToolCalls()).toEqual([]);
    });
});
