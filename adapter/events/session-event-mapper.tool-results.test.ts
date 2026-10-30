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
    /** The absolute paths the mapper asked the session about, in order. */
    readonly taken: string[];
}

/** What the engine recorded for each written file, consumed FIFO per path. */
function recordingMapper(writes: Record<string, RecordedChange[]> = {}): RecordingMapper {
    const pending = new Map(Object.entries(writes).map(([path, records]) => [path, [...records]]));
    const taken: string[] = [];
    const mapper = new SessionEventMapper({
        cwd,
        takeWrite: path => {
            taken.push(path);
            return pending.get(path)?.shift();
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
    toolName: string;
    args?: unknown;
    result: unknown;
    isError?: boolean;
    writes?: Record<string, RecordedChange[]>;
}

function endUpdate(options: EndOptions): ToolCallUpdate & { taken: string[] } {
    const { mapper, taken } = recordingMapper(options.writes);
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

    test("a command never asks the session about a written file", () => {
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
            writes: { [path]: [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual([path]);
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([{ type: "diff", path, oldText: null, newText: "hi\n" }]);
    });

    test("a write over an existing file reports the replaced text", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "new\n" },
            result: toolResult("Successfully wrote 4 bytes to a.txt", { resolvedPath: path }),
            writes: { [path]: [{ path, oldText: "old\n", newText: "new\n" }] },
        });

        expect(update.content).toEqual([
            { type: "diff", path, oldText: "old\n", newText: "new\n" },
        ]);
    });

    test("the diff names the file the engine recorded, not the one it was asked about", () => {
        const resolved = join(cwd, "a.txt");
        const recorded = join(cwd, "src", "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("wrote a.txt", { resolvedPath: resolved }),
            writes: { [resolved]: [{ path: recorded, oldText: null, newText: "hi\n" }] },
        });

        expect(update.locations).toEqual([{ path: recorded }]);
        expect(update.content).toEqual([
            { type: "diff", path: recorded, oldText: null, newText: "hi\n" },
        ]);
    });

    test("a write with no diff to show says why instead", () => {
        const path = join(cwd, "secret.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "secret.txt", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to secret.txt", { resolvedPath: path }),
            writes: { [path]: [{ path, noDiff: "it is a binary file" }] },
        });

        expect(update.status).toBe("completed");
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to secret.txt"),
            textContent(`No diff for ${path}: it is a binary file`),
        ]);
    });

    test("a write the engine recorded nothing for reports the result text", () => {
        const path = join(cwd, "notes.md");
        const update = endUpdate({
            toolName: "write",
            args: { path: "notes.md", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to notes.md", { resolvedPath: path }),
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual([path]);
        expect(update.content).toEqual([textContent("Successfully wrote 3 bytes to notes.md")]);
    });

    test("a write to a target that is not a file asks the session about nothing", () => {
        const update = endUpdate({
            toolName: "write",
            args: { path: "local://notes.md", content: "hi\n" },
            result: toolResult("Successfully wrote 3 bytes to local://notes.md", {}),
        });

        expect(update.taken).toEqual([]);
        expect(update.content).toEqual([
            textContent("Successfully wrote 3 bytes to local://notes.md"),
        ]);
    });

    test("a failed write reports the error text and still clears its record", () => {
        const path = join(cwd, "a.txt");
        const update = endUpdate({
            toolName: "write",
            args: { path: "a.txt", content: "hi\n" },
            result: toolResult("Permission denied", { resolvedPath: path }),
            isError: true,
            writes: { [path]: [{ path, oldText: null, newText: "hi\n" }] },
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Permission denied")]);
        expect(update.taken).toEqual([path]);
    });
});

describe("proposal.0001 edit results", () => {
    test("a successful edit reports the diff its own result carries", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: `[b.txt#2543]\nPUT 2.=2:\n+TWO` },
            result: toolResult("[b.txt#CFBD]\n1:one\n2:TWO\n3:three", {
                path,
                op: "update",
                oldText: "one\ntwo\nthree\n",
                newText: "one\nTWO\nthree\n",
            }),
        });

        expect(update.status).toBe("completed");
        expect(update.taken).toEqual([]);
        expect(update.locations).toEqual([{ path }]);
        expect(update.content).toEqual([
            { type: "diff", path, oldText: "one\ntwo\nthree\n", newText: "one\nTWO\nthree\n" },
        ]);
    });

    test("a multi-file edit reports one diff per affected file", () => {
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

    // `REM` reports `op: "delete"` with `oldText` and no `newText` (engine, 2026-10-30).
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

    // `MV` reports the destination as `path`, the origin as `sourcePath` (engine, 2026-10-30).
    test("an edit that moves a file reports both files, diffing the destination", () => {
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
            { type: "diff", path: destination, oldText: "cee\n", newText: "cee\n" },
        ]);
    });

    test("a file whose text Oh My Pi pruned is named with the reason instead", () => {
        const kept = join(cwd, "a.txt");
        const pruned = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "…" },
            result: toolResult("edited 2 files", {
                perFileResults: [
                    { path: kept, oldText: "a\n", newText: "A\n" },
                    { path: pruned, snapshotsPruned: true },
                ],
            }),
        });

        expect(update.locations).toEqual([{ path: kept }, { path: pruned }]);
        expect(update.content).toEqual([
            { type: "diff", path: kept, oldText: "a\n", newText: "A\n" },
            textContent(
                `No diff for ${pruned}: Oh My Pi did not keep the text of an edit this large`,
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

    test("a failed edit reports the error text instead of a diff", () => {
        const path = join(cwd, "b.txt");
        const update = endUpdate({
            toolName: "edit",
            args: { input: "[b.txt#0000]\nPUT 2.=2:\n+TWO" },
            result: toolResult("Edit rejected: stale tag", {
                path,
                oldText: "one\n",
                newText: "ONE\n",
            }),
            isError: true,
        });

        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("Edit rejected: stale tag")]);
    });
});
