import type { SessionUpdate, ToolCallContent, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { RecordedChange } from "../engine/pico-session.ts";

import {
    toolExecutionEnd,
    toolExecutionStart,
    toolExecutionUpdate,
    toolResult,
} from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

const cwd = "/workspace";

interface RecordingMapper {
    readonly mapper: SessionEventMapper;
    /** The tool call ids the mapper asked the session about, in order. */
    readonly taken: string[];
}

/** What the engine recorded for each call, consumed when that call ends. */
function recordingMapper(changes: Record<string, RecordedChange[]> = {}): RecordingMapper {
    const pending = new Map(Object.entries(changes));
    const taken: string[] = [];
    const mapper = new SessionEventMapper({
        cwd,
        takeRecordedChanges: toolCallId => {
            taken.push(toolCallId);
            const recorded = pending.get(toolCallId) ?? [];
            pending.delete(toolCallId);
            return recorded;
        },
        mcpToolIdentity: () => undefined,
    });
    return { mapper, taken };
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
        const { mapper } = recordingMapper();
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
        const { mapper } = recordingMapper();
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

    test("a partial result that arrives after the call ended is ignored", () => {
        const { mapper } = recordingMapper();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "sleep 30" },
            }),
        );
        mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: "bash",
                result: toolResult("Command aborted"),
                isError: true,
            }),
        );

        // The engine drains a killed command's output after it has reported the end.
        const updates = mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult("[Command cancelled]\n"),
            }),
        );

        expect(updates).toEqual([]);
    });
});

describe("proposal.0001 tool call results", () => {
    function endUpdate(options: {
        toolName: string;
        args?: unknown;
        result: unknown;
        isError?: boolean;
        changes?: Record<string, RecordedChange[]>;
    }): ToolCallUpdate & { taken: string[] } {
        const { mapper, taken } = recordingMapper(options.changes);
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
        return { ...toolCallUpdate(updates[0]), taken };
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

    test("a successful edit reports a diff for the file the engine recorded", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[b.txt#2543]\nPUT 2.=2:\n+TWO` },
            result: toolResult("[b.txt#CFBD]\n1:one\n2:TWO\n3:three", { path, op: "update" }),
            changes: {
                "call-1": [{ path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" }],
            },
        });

        expect(update.status).toBe("completed");
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" },
        ]);
    });

    test("a multi-file edit the engine pruned still reports one diff per file", () => {
        const first = join(cwd, "a.txt");
        const second = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            // Pruned snapshots: the result names the files but carries no text.
            result: toolResult("edited 2 files", {
                perFileResults: [{ path: first }, { path: second }],
            }),
            changes: {
                "call-1": [
                    { path: first, oldText: "a\n", newText: "A\n" },
                    { path: second, oldText: "b\n", newText: "B\n" },
                ],
            },
        });

        expect(update.locations).toEqual([{ path: first }, { path: second }]);
        expect(update.content).toEqual([
            { type: "diff", path: first, oldText: "a\n", newText: "A\n" },
            { type: "diff", path: second, oldText: "b\n", newText: "B\n" },
        ]);
    });

    test("an edit that empties one file still reports both files", () => {
        const kept = join(cwd, "a.txt");
        const emptied = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {}),
            changes: {
                "call-1": [
                    { path: kept, oldText: "a\n", newText: "A\n" },
                    { path: emptied, oldText: "b\n", newText: "" },
                ],
            },
        });

        expect(update.locations).toEqual([{ path: kept }, { path: emptied }]);
        expect(update.content).toEqual([
            { type: "diff", path: kept, oldText: "a\n", newText: "A\n" },
            { type: "diff", path: emptied, oldText: "b\n", newText: "" },
        ]);
    });

    test("an edit the engine recorded nothing for falls back to the result's own text", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[b.txt#2543]\nPUT 2.=2:\n+TWO` },
            result: toolResult("[b.txt#CFBD]\n1:one\n2:TWO\n3:three", {
                path,
                oldText: "one\ntwo\nthree\n",
                newText: "one\nTWO\nthree\n",
            }),
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" },
        ]);
    });

    test("an edit with neither a record nor result text reports what the model saw", () => {
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("Nothing to change", {}),
        });

        expect(update.status).toBe("completed");
        expect(update.content).toEqual([textContent("Nothing to change")]);
    });

    test("a failed edit reports the error text, and its record is consumed", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "[b.txt#0000]\nPUT 2.=2:\n+TWO" },
            result: toolResult("Edit rejected: stale tag", { path }),
            isError: true,
            changes: { "call-1": [{ path, oldText: "one\n", newText: "ONE\n" }] },
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Edit rejected: stale tag")]);
        expect(update.taken).toEqual(["call-1"]);
    });

    test("a write to a new file reports a diff with no old text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("[a.txt#E3D3]\nSuccessfully wrote 3 bytes to a.txt", {
                resolvedPath: path,
            }),
            changes: { "call-1": [{ path, oldText: null, newText: "hi\n" }] },
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
            changes: { "call-1": [{ path, oldText: "old\n", newText: "new\n" }] },
        });

        expect(update.content).toEqual([
            { type: "diff", path, oldText: "old\n", newText: "new\n" },
        ]);
    });

    test("the diff names the file the engine recorded, not the argument", () => {
        const recorded = join(cwd, "src", "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("wrote a.txt", {}),
            changes: { "call-1": [{ path: recorded, oldText: null, newText: "hi\n" }] },
        });

        expect(update.content).toEqual([
            { type: "diff", path: recorded, oldText: null, newText: "hi\n" },
        ]);
    });

    test("a failed write reports the error text, and its record is consumed", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("Permission denied", {}),
            isError: true,
            changes: { "call-1": [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Permission denied")]);
        expect(update.taken).toEqual(["call-1"]);
    });

    test("a write the engine recorded nothing for reports the result text", () => {
        const update = endUpdate({
            toolName: "write",
            args: { path: "local://notes.md", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to local://notes.md", {}),
        });

        expect(update.status).toBe("completed");
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to local://notes.md"),
        ]);
    });

    test("a write with no diff to show says why instead", () => {
        const path = join(cwd, "secret.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "secret.txt", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to secret.txt", { resolvedPath: path }),
            changes: {
                "call-1": [{ path, noDiff: `it could not be read: EACCES: permission denied` }],
            },
        });

        expect(update.status).toBe("completed");
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to secret.txt"),
            textContent(`No diff for ${path}: it could not be read: EACCES: permission denied`),
        ]);
    });

    test("an edit diffs the files it can and explains the one it cannot", () => {
        const diffable = join(cwd, "a.txt");
        const undiffable = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {}),
            changes: {
                "call-1": [
                    { path: diffable, oldText: "a\n", newText: "A\n" },
                    { path: undiffable, noDiff: "it is larger than 1 MiB" },
                ],
            },
        });

        expect(update.locations).toEqual([{ path: diffable }, { path: undiffable }]);
        expect(update.content).toEqual([
            { type: "diff", path: diffable, oldText: "a\n", newText: "A\n" },
            textContent(`No diff for ${undiffable}: it is larger than 1 MiB`),
        ]);
    });

    test("a failed edit still only reports the error text", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("Edit rejected: stale tag", { path }),
            isError: true,
            changes: { "call-1": [{ path, noDiff: "it could not be read" }] },
        });

        expect(update.content).toEqual([textContent("Edit rejected: stale tag")]);
    });
});
