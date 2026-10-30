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

/**
 * A 32-bit xorshift, deterministic per seed. Every step stays in uint32: a
 * multiplying generator loses its low bits once the state passes 2^53, which
 * silently collapses `% 4` to one branch and stops generating ends at all.
 */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

function randomSequence(seed: number): AgentSessionEvent[] {
    const next = randomSource(seed);
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

/** What the generated sequences actually contained, so the property cannot pass vacuously. */
interface Coverage {
    starts: number;
    updates: number;
    completedEnds: number;
    failedEnds: number;
    /** Ends for a call that had already ended. */
    duplicateEnds: number;
    /** Updates or ends for a call that never started. */
    orphans: number;
}

function tally(events: AgentSessionEvent[], coverage: Coverage): void {
    const seen = new Map<string, "running" | "ended">();
    for (const event of events) {
        if (event.type === "tool_execution_start") {
            coverage.starts++;
            seen.set(event.toolCallId, "running");
            continue;
        }
        if (event.type === "tool_execution_update") {
            coverage.updates++;
            if (!seen.has(event.toolCallId)) coverage.orphans++;
            continue;
        }
        if (event.type !== "tool_execution_end") continue;
        if (event.isError === true) coverage.failedEnds++;
        else coverage.completedEnds++;
        const state = seen.get(event.toolCallId);
        if (state === undefined) coverage.orphans++;
        else if (state === "ended") coverage.duplicateEnds++;
        seen.set(event.toolCallId, "ended");
    }
}

function toolCallIdOf(update: SessionUpdate): string | undefined {
    return update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update"
        ? update.toolCallId
        : undefined;
}

describe("proposal.0001 tool call reporting invariants", () => {
    test("for any engine sequence every started call is opened once, in order, and settles once", () => {
        const coverage: Coverage = {
            starts: 0,
            updates: 0,
            completedEnds: 0,
            failedEnds: 0,
            duplicateEnds: 0,
            orphans: 0,
        };

        for (let seed = 1; seed <= 200; seed++) {
            const mapper = new SessionEventMapper({
                cwd: "/workspace",
                takeChanges: () => [],
                mcpToolIdentity: () => undefined,
            });
            const events = randomSequence(seed);
            tally(events, coverage);
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

        // The property is only worth its name if the sequences contained the shapes
        // it claims to cover.
        expect(coverage.starts, "generated starts").toBeGreaterThan(0);
        expect(coverage.updates, "generated updates").toBeGreaterThan(0);
        expect(coverage.completedEnds, "generated successful ends").toBeGreaterThan(0);
        expect(coverage.failedEnds, "generated failed ends").toBeGreaterThan(0);
        expect(coverage.duplicateEnds, "generated duplicate ends").toBeGreaterThan(0);
        expect(coverage.orphans, "generated orphan events").toBeGreaterThan(0);
    });

    test("a second end for the same call reports nothing", () => {
        const mapper = new SessionEventMapper({
            cwd: "/workspace",
            takeChanges: () => [],
            mcpToolIdentity: () => undefined,
        });
        mapper.map(toolExecutionStart({ toolCallId: "call-1", toolName: "read", args: {} }));
        mapper.map(
            toolExecutionEnd({ toolCallId: "call-1", toolName: "read", result: toolResult("a") }),
        );

        const repeated = mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: "read",
                result: toolResult("a"),
                isError: true,
            }),
        );

        expect(repeated).toEqual([]);
    });

    test("an end for a call that never started reports nothing", () => {
        const mapper = new SessionEventMapper({
            cwd: "/workspace",
            takeChanges: () => [],
            mcpToolIdentity: () => undefined,
        });

        const orphan = mapper.map(
            toolExecutionEnd({ toolCallId: "call-9", toolName: "read", result: toolResult("a") }),
        );

        expect(orphan).toEqual([]);
    });

    test("closing open tool calls fails only the calls still running", () => {
        const mapper = new SessionEventMapper({
            cwd: "/workspace",
            takeChanges: () => [],
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
            takeChanges: () => [],
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
