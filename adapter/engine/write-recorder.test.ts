import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

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
});
