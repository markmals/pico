import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { RecordedChange } from "./write-recorder.ts";

import { temporaryDirectory } from "./testing/session-fixture.ts";
import { WriteRecorder } from "./write-recorder.ts";

type Hook = (event: unknown) => unknown;

/** The hooks the recorder registers, driven directly so a test can shape a result OMP only produces at scale. */
async function hooksOf(recorder: WriteRecorder): Promise<Map<string, Hook>> {
    const hooks = new Map<string, Hook>();
    // The recorder calls nothing but `on`, so a capturing stub stands in for the whole API.
    const api = {
        on: (event: string, hook: Hook) => {
            hooks.set(event, hook);
        },
    } as unknown as ExtensionAPI;
    await recorder.extension().factory?.(api);
    return hooks;
}

/** The recorder reported that it could not read `file`, and said why. */
function assertUnreadable(records: RecordedChange[], file: string): void {
    assert.equal(records.length, 1);
    const [record] = records;
    assert.ok(
        record && "unreadable" in record,
        `expected an unreadable record, got ${JSON.stringify(records)}`,
    );
    assert.equal(record.path, file);
    assert.match(record.unreadable, /EACCES/);
    assert.ok(
        record.unreadable.includes(file),
        `the cause does not name the file: ${record.unreadable}`,
    );
}

describe("proposal.0001 recorded writes", () => {
    test("an edit whose snapshot OMP pruned still supplies the write's old text", async t => {
        const cwd = temporaryDirectory(t, "recorder");
        const file = path.join(cwd, "pruned.txt");
        fs.writeFileSync(file, "before\n");
        const recorder = new WriteRecorder(cwd);
        const hooks = await hooksOf(recorder);
        const toolCall = hooks.get("tool_call");
        const toolResult = hooks.get("tool_result");
        assert.ok(toolCall && toolResult, "the recorder registered no tool hooks");

        await toolCall({
            type: "tool_call",
            toolName: "write",
            toolCallId: "write-1",
            input: { path: "pruned.txt", content: "final\n" },
        });
        await toolCall({
            type: "tool_call",
            toolName: "edit",
            toolCallId: "edit-1",
            input: { input: "[pruned.txt#ABCD]\nPUT 1.=1:\n+edited" },
        });

        // An oversized multi-file edit: OMP drops `oldText`/`newText` and marks the entry pruned.
        fs.writeFileSync(file, "edited\n");
        await toolResult({
            type: "tool_result",
            toolName: "edit",
            toolCallId: "edit-1",
            isError: false,
            input: {},
            content: [],
            details: {
                diff: "",
                perFileResults: [{ path: file, diff: "", snapshotsPruned: true }],
            },
        });

        fs.writeFileSync(file, "final\n");
        await toolResult({
            type: "tool_result",
            toolName: "write",
            toolCallId: "write-1",
            isError: false,
            input: {},
            content: [],
        });

        assert.deepEqual(recorder.take("edit-1"), [
            { path: file, oldText: "before\n", newText: "edited\n" },
        ]);
        assert.deepEqual(recorder.take("write-1"), [
            { path: file, oldText: "edited\n", newText: "final\n" },
        ]);
    });

    test("a file that becomes unreadable after its snapshot is reported as unreadable", async t => {
        const cwd = temporaryDirectory(t, "recorder");
        const file = path.join(cwd, "locked.txt");
        fs.writeFileSync(file, "before\n");
        const recorder = new WriteRecorder(cwd);
        const hooks = await hooksOf(recorder);
        const toolCall = hooks.get("tool_call");
        const toolResult = hooks.get("tool_result");
        assert.ok(toolCall && toolResult, "the recorder registered no tool hooks");

        await toolCall({
            type: "tool_call",
            toolName: "write",
            toolCallId: "write-1",
            input: { path: "locked.txt", content: "after\n" },
        });

        fs.chmodSync(file, 0o000);
        await toolResult({
            type: "tool_result",
            toolName: "write",
            toolCallId: "write-1",
            isError: false,
            input: {},
            content: [],
        });

        assertUnreadable(recorder.take("write-1"), file);
    });

    test("a file that was unreadable at its snapshot is reported as unreadable", async t => {
        const cwd = temporaryDirectory(t, "recorder");
        const file = path.join(cwd, "opaque.txt");
        fs.writeFileSync(file, "before\n");
        fs.chmodSync(file, 0o200);
        const recorder = new WriteRecorder(cwd);
        const hooks = await hooksOf(recorder);
        const toolCall = hooks.get("tool_call");
        const toolResult = hooks.get("tool_result");
        assert.ok(toolCall && toolResult, "the recorder registered no tool hooks");

        await toolCall({
            type: "tool_call",
            toolName: "write",
            toolCallId: "write-1",
            input: { path: "opaque.txt", content: "after\n" },
        });

        fs.writeFileSync(file, "after\n");
        fs.chmodSync(file, 0o644);
        await toolResult({
            type: "tool_result",
            toolName: "write",
            toolCallId: "write-1",
            isError: false,
            input: {},
            content: [],
        });

        assertUnreadable(recorder.take("write-1"), file);
    });
});
