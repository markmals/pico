import type { SessionUpdate, ToolCallContent, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
    toolExecutionEnd,
    toolExecutionStart,
    toolExecutionUpdate,
    toolResult,
} from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

const cwd = "/workspace";

interface RecordedWriteFixture {
    oldText: string | null;
    newText: string;
}

function mapperWithWrites(writes: Record<string, RecordedWriteFixture> = {}): SessionEventMapper {
    const pending = new Map(Object.entries(writes));
    return new SessionEventMapper({
        cwd,
        takeRecordedWrite: path => {
            const recorded = pending.get(path);
            pending.delete(path);
            return recorded;
        },
    });
}

function toolCallUpdate(update: SessionUpdate | undefined): ToolCallUpdate {
    expect(update?.sessionUpdate).toBe("tool_call_update");
    return update as SessionUpdate & { sessionUpdate: "tool_call_update" };
}

function textContent(text: string): ToolCallContent {
    return { type: "content", content: { type: "text", text } };
}

describe("proposal.0001 tool call progress", () => {
    test("a partial result becomes a tool_call_update carrying the output so far", () => {
        const mapper = mapperWithWrites();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "bun test" },
            }),
        );

        const updates = mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult("1 pass\n"),
            }),
        );

        expect(updates).toHaveLength(1);
        const update = toolCallUpdate(updates[0]);
        expect(update.toolCallId).toBe("call-1");
        expect(update.content).toEqual([textContent("1 pass\n")]);
    });

    test("a later partial result replaces the content with the combined output", () => {
        const mapper = mapperWithWrites();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "bun test" },
            }),
        );
        mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult("1 pass\n"),
            }),
        );

        const updates = mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult("1 pass\n0 fail\n"),
            }),
        );

        expect(toolCallUpdate(updates[0]).content).toEqual([textContent("1 pass\n0 fail\n")]);
    });
});

describe("proposal.0001 tool call results", () => {
    function endUpdate(options: {
        toolName: string;
        args?: unknown;
        result: unknown;
        isError?: boolean;
        writes?: Record<string, RecordedWriteFixture>;
    }): ToolCallUpdate {
        const mapper = mapperWithWrites(options.writes);
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: options.toolName,
                args: options.args ?? {},
            }),
        );
        const updates = mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: options.toolName,
                result: options.result,
                isError: options.isError,
            }),
        );
        expect(updates).toHaveLength(1);
        return toolCallUpdate(updates[0]);
    }

    test("a successful command completes with its output and the result details", () => {
        const update = endUpdate({
            toolName: "bash",
            args: { command: "echo hello" },
            result: toolResult("hello\n", { wallTimeMs: 12 }),
        });

        expect(update.status).toBe("completed");
        expect(update.rawOutput).toEqual({ wallTimeMs: 12 });
        expect(update.content).toEqual([textContent("hello\n")]);
    });

    test("a failed command fails with the text the model received", () => {
        const update = endUpdate({
            toolName: "bash",
            args: { command: "exit 3" },
            result: toolResult("Command failed with exit code 3\n", { exitCode: 3 }),
            isError: true,
        });

        expect(update.status).toBe("failed");
        expect(update.rawOutput).toEqual({ exitCode: 3 });
        expect(update.content).toEqual([textContent("Command failed with exit code 3\n")]);
    });

    test("a successful edit reports a diff for the file it changed", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[b.txt#2543]\nPUT 2.=2:\n+TWO` },
            result: toolResult("[b.txt#CFBD]\n1:one\n2:TWO\n3:three", {
                path,
                oldText: "one\ntwo\nthree\n",
                newText: "one\nTWO\nthree\n",
                diff: " 1|one\n-2|two\n+2|TWO\n 3|three",
                op: "update",
            }),
        });

        expect(update.status).toBe("completed");
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" },
        ]);
    });

    test("a successful multi-file edit reports one diff per affected file", () => {
        const first = join(cwd, "a.txt");
        const second = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {
                perFileResults: [
                    { path: first, oldText: "a\n", newText: "A\n" },
                    { path: second, oldText: "b\n", newText: "B\n" },
                ],
            }),
        });

        expect(update.locations).toEqual([{ path: first }, { path: second }]);
        expect(update.content).toEqual([
            { type: "diff", path: first, oldText: "a\n", newText: "A\n" },
            { type: "diff", path: second, oldText: "b\n", newText: "B\n" },
        ]);
    });

    test("a failed edit reports the error text instead of a diff", () => {
        const update = endUpdate({
            toolName: "edit",
            args: { input: "[b.txt#0000]\nPUT 2.=2:\n+TWO" },
            result: toolResult("Edit rejected: stale tag", { path: join(cwd, "b.txt") }),
            isError: true,
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Edit rejected: stale tag")]);
    });

    test("a write to a new file reports a diff with no old text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("[a.txt#E3D3]\nSuccessfully wrote 3 bytes to a.txt", {
                resolvedPath: path,
            }),
            writes: { [path]: { oldText: null, newText: "hi\n" } },
        });

        expect(update.status).toBe("completed");
        expect(update.content).toEqual([{ type: "diff", path, oldText: null, newText: "hi\n" }]);
    });

    test("a write over an existing file reports the replaced text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "new\n" },
            result: toolResult("[a.txt#AAAA]\nSuccessfully wrote 4 bytes to a.txt", {
                resolvedPath: path,
            }),
            writes: { [path]: { oldText: "old\n", newText: "new\n" } },
        });

        expect(update.content).toEqual([
            { type: "diff", path, oldText: "old\n", newText: "new\n" },
        ]);
    });

    test("a failed write reports the error text instead of a diff", () => {
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("Permission denied", {}),
            isError: true,
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Permission denied")]);
    });
});
