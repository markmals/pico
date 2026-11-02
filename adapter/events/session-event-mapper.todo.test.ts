import { describe, expect, test } from "bun:test";

import {
    toolExecutionEnd,
    toolExecutionStart,
    toolExecutionUpdate,
    toolResult,
} from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

const INIT = { op: "init", items: ["Write the test", "Write the code"] };

function mapper(): SessionEventMapper {
    return new SessionEventMapper({
        cwd: "/workspace",
        takeChanges: () => [],
        mcpToolIdentity: () => undefined,
    });
}

describe("proposal.0006 the todo call in the transcript", () => {
    test("a successful todo call reports nothing", () => {
        const events = mapper();

        const started = events.map(
            toolExecutionStart({
                toolCallId: "todo-1",
                toolName: "todo",
                args: INIT,
                intent: "Planning the work",
            }),
        );
        const updated = events.map(
            toolExecutionUpdate({
                toolCallId: "todo-1",
                toolName: "todo",
                partialResult: toolResult("partial"),
            }),
        );
        const ended = events.map(
            toolExecutionEnd({
                toolCallId: "todo-1",
                toolName: "todo",
                result: toolResult("Overall: 0/2 done", { op: "init", phases: [] }),
            }),
        );

        expect([...started, ...updated, ...ended]).toEqual([]);
        expect(events.closeOpenToolCalls()).toEqual([]);
    });

    test("a failed todo call is reported once, when it ends, as a failed call with the engine's error", () => {
        const events = mapper();
        const details = { phases: [], storage: "session" };

        const started = events.map(
            toolExecutionStart({
                toolCallId: "todo-1",
                toolName: "todo",
                args: { op: "done", task: "Z" },
                intent: "Finishing Z",
            }),
        );
        const ended = events.map(
            toolExecutionEnd({
                toolCallId: "todo-1",
                toolName: "todo",
                result: toolResult('Errors: Task "Z" not found', details),
                isError: true,
            }),
        );

        expect(started).toEqual([]);
        expect(ended).toEqual([
            {
                sessionUpdate: "tool_call",
                toolCallId: "todo-1",
                name: "todo",
                title: "Finishing Z",
                kind: "other",
                status: "in_progress",
                rawInput: { op: "done", task: "Z" },
            },
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "todo-1",
                status: "failed",
                rawOutput: details,
                content: [
                    {
                        type: "content",
                        content: { type: "text", text: 'Errors: Task "Z" not found' },
                    },
                ],
            },
        ]);
        expect(events.closeOpenToolCalls()).toEqual([]);
    });

    test("a todo call without a stated intent is titled Update plan", () => {
        const events = mapper();
        events.map(toolExecutionStart({ toolCallId: "todo-1", toolName: "todo", args: INIT }));

        const ended = events.map(
            toolExecutionEnd({
                toolCallId: "todo-1",
                toolName: "todo",
                result: toolResult("Errors: Duplicate task"),
                isError: true,
            }),
        );

        expect(ended[0]).toMatchObject({ sessionUpdate: "tool_call", title: "Update plan" });
    });

    test("a todo call still open when the turn is cancelled is reported as a cancelled failure", () => {
        const events = mapper();
        events.map(
            toolExecutionStart({
                toolCallId: "todo-1",
                toolName: "todo",
                args: INIT,
                intent: "Planning the work",
            }),
        );

        expect(events.closeOpenToolCalls()).toEqual([
            {
                sessionUpdate: "tool_call",
                toolCallId: "todo-1",
                name: "todo",
                title: "Planning the work",
                kind: "other",
                status: "in_progress",
                rawInput: INIT,
            },
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "todo-1",
                status: "failed",
                content: [{ type: "content", content: { type: "text", text: "Cancelled" } }],
            },
        ]);
    });
});
