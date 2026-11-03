import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";

import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, test } from "bun:test";

import type { ToolPresentation } from "./tool-presentation.ts";

import { backgroundDetails } from "./engine-event-fixtures.ts";
import { replayHistory } from "./history-replay.ts";

const cwd = "/workspace";

/** What Oh My Pi tells the model when a command moves to the background. */
const NOTICE = "Backgrounded as job bg_1 (bash). Do NOT poll for it.";

const ZERO_USAGE: AssistantMessage["usage"] = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"]): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "mock",
        provider: "mock",
        model: "mock-model",
        stopReason: "toolUse",
        usage: ZERO_USAGE,
        timestamp: 1,
    };
}

/** A saved conversation holding one tool call and the result it returned. */
function historyWith(
    call: { name: string; arguments: Record<string, unknown> },
    result: { text: string; details?: Record<string, unknown> },
): SessionManager {
    const manager = SessionManager.inMemory(cwd);
    manager.appendMessage({ role: "user", content: "run the tests", timestamp: 1 });
    manager.appendMessage(assistant([{ type: "toolCall", id: "call-1", ...call }]));
    manager.appendMessage({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: call.name,
        content: [{ type: "text", text: result.text }],
        details: result.details,
        isError: false,
        timestamp: 2,
    });
    return manager;
}

/** A `bash` call whose command moved to job `bg_1` before the previous process stopped. */
function backgroundHistory(): SessionManager {
    return historyWith(
        { name: "bash", arguments: { command: "make test" } },
        { text: NOTICE, details: backgroundDetails("running") },
    );
}

function replay(
    manager: SessionManager,
    presentations: Map<string, ToolPresentation>,
): SessionUpdate[] {
    return [...replayHistory(manager, cwd, presentations)].filter(
        update => update.sessionUpdate !== "user_message_chunk",
    );
}

function settlements(presentations: Map<string, ToolPresentation>): SessionUpdate[] {
    return replay(backgroundHistory(), presentations).filter(
        update => update.sessionUpdate === "tool_call_update",
    );
}

/** The terminal update Pico saved for the call when its job ended. */
function savedEnd(status: "completed" | "failed", text: string): ToolPresentation {
    return {
        end: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status,
            rawOutput: backgroundDetails(status),
            content: [{ type: "content", content: { type: "text", text } }],
        },
    };
}

describe("proposal.0008 replaying a background command", () => {
    test("fails with an unknown outcome when the process stopped while the job ran", () => {
        const updates = settlements(new Map());

        expect(updates).toEqual([
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "call-1",
                status: "failed",
                content: [
                    {
                        type: "content",
                        content: {
                            type: "text",
                            text: "The previous process ended before bash returned; its outcome is unknown.",
                        },
                    },
                ],
            },
        ]);
    });

    test("shows how the job ended when it finished", () => {
        const presentation = savedEnd("completed", "ok\n\n\nWall time: 1.08 seconds");

        expect(settlements(new Map([["call-1", presentation]]))).toEqual([presentation.end!]);
    });

    test("shows how the job ended when it failed", () => {
        const presentation = savedEnd("failed", "[Command cancelled]\n");

        expect(settlements(new Map([["call-1", presentation]]))).toEqual([presentation.end!]);
    });
});

describe("proposal.0008 replaying a wait call", () => {
    test("is reported as waiting for background jobs and settled by its report", () => {
        const report = "## Completed (1)\n\n### bg_1 [bash] — completed\n";

        const updates = replay(
            historyWith({ name: "wait", arguments: {} }, { text: report }),
            new Map(),
        );

        expect(updates[0]).toEqual({
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            name: "wait",
            title: "Wait for background jobs",
            kind: "other",
            status: "in_progress",
            rawInput: {},
        });
        expect(updates[1]).toMatchObject({
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: report } }],
        });
    });
});
