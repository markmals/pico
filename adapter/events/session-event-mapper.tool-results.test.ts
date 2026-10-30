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

/** The writes the engine attributed to each tool call, consumed when that call ends. */
function recordingMapper(changes: Record<string, RecordedChange[]> = {}): RecordingMapper {
    const pending = new Map(Object.entries(changes).map(([id, records]) => [id, [...records]]));
    const taken: string[] = [];
    const mapper = new SessionEventMapper({
        cwd,
        takeChanges: toolCallId => {
            taken.push(toolCallId);
            return pending.get(toolCallId)?.splice(0) ?? [];
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

interface EndOptions {
    toolCallId?: string;
    toolName: string;
    args?: unknown;
    result: unknown;
    isError?: boolean;
    changes?: Record<string, RecordedChange[]>;
}

function endUpdate(options: EndOptions): ToolCallUpdate & { taken: string[] } {
    const { mapper, taken } = recordingMapper(options.changes);
    const toolCallId = options.toolCallId ?? "call-1";
    mapper.map(
        toolExecutionStart({ toolCallId, toolName: options.toolName, args: options.args ?? {} }),
    );
    const updates = mapper.map(
        toolExecutionEnd({
            toolCallId,
            toolName: options.toolName,
            result: options.result,
            isError: options.isError,
        }),
    );
    expect(updates).toHaveLength(1);
    return { ...toolCallUpdate(updates[0]), taken };
}

describe("proposal.0001 command results", () => {
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

    test("a command never asks the session what it changed", () => {
        const update = endUpdate({
            toolName: "bash",
            args: { command: "echo hello" },
            result: toolResult("hello\n", { resolvedPath: join(cwd, "a.txt") }),
        });

        expect(update.taken).toEqual([]);
    });
});

describe("proposal.0001 write results", () => {
    test("a write to a new file reports a diff with no old text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to a.txt", { resolvedPath: path }),
            changes: { "call-1": [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual(["call-1"]);
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([{ type: "diff", path, oldText: null, newText: "hi\n" }]);
    });

    test("a write over an existing file reports the replaced text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "new\n" },
            result: toolResult("Successfully wrote 4 bytes to a.txt", { resolvedPath: path }),
            changes: { "call-1": [{ path, oldText: "old\n", newText: "new\n" }] },
        });

        expect(update.content).toEqual([
            { type: "diff", path, oldText: "old\n", newText: "new\n" },
        ]);
    });

    // An extension's `tool_result` hook may replace the result wholesale; the write
    // the engine attributed to the call is still the write that happened.
    test("a write whose result no longer names a file still reports its diff", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("wrote it", { custom: true }),
            changes: { "call-1": [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([{ type: "diff", path, oldText: null, newText: "hi\n" }]);
    });

    test("a write with no diff to show says why instead", () => {
        const path = join(cwd, "secret.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "secret.txt", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to secret.txt", { resolvedPath: path }),
            changes: { "call-1": [{ path, noDiff: "it is a binary file" }] },
        });

        expect(update.status).toBe("completed");
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to secret.txt"),
            textContent(`No diff for ${path}: it is a binary file`),
        ]);
    });

    test("a write the engine attributed nothing to reports the result text", () => {
        const update = endUpdate({
            toolName: "write",
            args: { path: "local://notes.md", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to local://notes.md", {}),
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual(["call-1"]);
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to local://notes.md"),
        ]);
    });

    test("a failed write reports the error text and still clears its records", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("Permission denied", { resolvedPath: path }),
            isError: true,
            changes: { "call-1": [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Permission denied")]);
        expect(update.taken).toEqual(["call-1"]);
    });

    // Codex's repro: both calls land in one batch and both write the same file.
    test("an edit and a write to one file in the same batch each show their own change", () => {
        const path = join(cwd, "a.txt");
        const { mapper } = recordingMapper({
            "edit-1": [{ path, oldText: "before\n", newText: "edited\n" }],
            "write-1": [{ path, oldText: "edited\n", newText: "final\n" }],
        });
        const run = (toolCallId: string, toolName: string, result: unknown) => {
            mapper.map(toolExecutionStart({ toolCallId, toolName, args: {} }));
            return toolCallUpdate(
                mapper.map(toolExecutionEnd({ toolCallId, toolName, result }))[0],
            );
        };

        const edited = run("edit-1", "edit", toolResult("edited a.txt", { path }));
        const written = run("write-1", "write", toolResult("wrote a.txt", { resolvedPath: path }));

        expect(edited.content).toEqual([
            { type: "diff", path, oldText: "before\n", newText: "edited\n" },
        ]);
        expect(written.content).toEqual([
            { type: "diff", path, oldText: "edited\n", newText: "final\n" },
        ]);
    });
});

describe("proposal.0001 edit results", () => {
    test("a successful edit reports the change the engine attributed to it", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[b.txt#2543]\nPUT 2.=2:\n+TWO` },
            result: toolResult("[b.txt#CFBD]\n1:one\n2:TWO\n3:three", {
                path,
                op: "update",
                oldText: "stale\n",
                newText: "stale\n",
            }),
            changes: {
                "call-1": [{ path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" }],
            },
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual(["call-1"]);
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" },
        ]);
    });

    // Codex's repro: OMP drops the snapshot of an edit this large, the bridge does not.
    test("an edit whose text Oh My Pi pruned still shows the exact change", () => {
        const path = join(cwd, "big.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited big.txt", { path, snapshotsPruned: true }),
            changes: { "call-1": [{ path, oldText: "before\n", newText: "after\n" }] },
        });

        expect(update.content).toEqual([
            { type: "diff", path, oldText: "before\n", newText: "after\n" },
        ]);
    });

    test("an edit Oh My Pi pruned with nothing attributed to it says why", () => {
        const path = join(cwd, "big.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited big.txt", { path, snapshotsPruned: true }),
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("edited big.txt"),
            textContent(
                `No diff for ${path}: Oh My Pi did not keep the text of an edit this large`,
            ),
        ]);
    });

    test("a multi-file edit falls back to the result for a file nothing was attributed to", () => {
        const recorded = join(cwd, "a.txt");
        const reported = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {
                perFileResults: [
                    { path: recorded, oldText: "stale\n", newText: "stale\n" },
                    { path: reported, oldText: "b\n", newText: "B\n" },
                ],
            }),
            changes: { "call-1": [{ path: recorded, oldText: "a\n", newText: "A\n" }] },
        });

        expect(update.locations).toEqual([{ path: recorded }, { path: reported }]);
        expect(update.content).toEqual([
            { type: "diff", path: recorded, oldText: "a\n", newText: "A\n" },
            { type: "diff", path: reported, oldText: "b\n", newText: "B\n" },
        ]);
    });

    // `REM` reports `op: "delete"` with `oldText`, no `newText`, and writes nothing
    // through the bridge (engine, 2026-10-30).
    test("an edit that removes a file reports a diff with empty new text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[a.txt#2543]\nREM` },
            result: toolResult("Removed a.txt", {
                diff: "",
                op: "delete",
                path,
                oldText: "one\ntwo\nthree\n",
            }),
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "" },
        ]);
    });

    // `MV` renames: neither path reaches the bridge, and the result says nothing
    // about what the destination held before (engine, 2026-10-30).
    test("an edit that moves a file empties the source and names the destination", () => {
        const source = join(cwd, "c.txt");
        const destination = join(cwd, "d.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[c.txt#2543]\nMV d.txt` },
            result: toolResult("Moved c.txt to d.txt", {
                diff: "",
                op: "update",
                move: destination,
                sourcePath: source,
                path: destination,
                oldText: "cee\n",
                newText: "cee\n",
            }),
        });

        expect(update.locations).toEqual([{ path: destination }, { path: source }]);
        expect(update.content).toEqual([
            { type: "diff", path: source, oldText: "cee\n", newText: "" },
            textContent(
                `No diff for ${destination}: Oh My Pi did not report what the move replaced`,
            ),
        ]);
    });

    test("a move whose text Oh My Pi pruned names both files instead of inventing a diff", () => {
        const source = join(cwd, "c.txt");
        const destination = join(cwd, "d.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {
                perFileResults: [
                    {
                        diff: "",
                        op: "update",
                        move: destination,
                        sourcePath: source,
                        path: destination,
                        snapshotsPruned: true,
                    },
                ],
            }),
        });

        expect(update.locations).toEqual([{ path: destination }, { path: source }]);
        expect(update.content).toEqual([
            textContent("edited 2 files"),
            textContent(
                `No diff for ${destination}: Oh My Pi did not report what the move replaced`,
            ),
            textContent(
                `No diff for ${source}: Oh My Pi did not keep the text of an edit this large`,
            ),
        ]);
    });

    test("a change larger than 1 MiB is named with the reason instead", () => {
        const path = join(cwd, "huge.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited huge.txt", {
                path,
                oldText: "a".repeat(1024 * 1024 + 1),
                newText: "b\n",
            }),
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("edited huge.txt"),
            textContent(`No diff for ${path}: it is larger than 1 MiB`),
        ]);
    });

    test("a change carrying a NUL byte is named with the reason instead", () => {
        const path = join(cwd, "binary.dat");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited binary.dat", {
                path,
                oldText: "before\n",
                newText: "after\0here\n",
            }),
        });

        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("edited binary.dat"),
            textContent(`No diff for ${path}: it is a binary file`),
        ]);
    });

    test("an edit whose result says nothing about the file reports the result text", () => {
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("Nothing to change", {}),
        });

        expect(update.status).toBe("completed");
        expect(update.content).toEqual([textContent("Nothing to change")]);
    });

    test("a failed edit reports the error text and still clears its records", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "[b.txt#0000]\nPUT 2.=2:\n+TWO" },
            result: toolResult("Edit rejected: stale tag", { path, oldText: "one\n" }),
            isError: true,
            changes: { "call-1": [{ path, oldText: "one\n", newText: "ONE\n" }] },
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Edit rejected: stale tag")]);
        expect(update.taken).toEqual(["call-1"]);
    });
});
