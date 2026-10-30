import type { SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { removeTemporaryDirectories } from "./engine-harness.ts";
import { closeOpenConnections, startPicoSession } from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

function endOf(updates: SessionUpdate[], toolCallId: string): ToolCallUpdate {
    const ended = updates
        .filter(update => update.sessionUpdate === "tool_call_update")
        .filter(update => update.toolCallId === toolCallId)
        .findLast(update => update.status === "completed" || update.status === "failed");
    if (!ended) throw new Error(`tool call ${toolCallId} never ended`);
    return ended;
}

function textOf(update: ToolCallUpdate): string {
    return (update.content ?? [])
        .map(content =>
            content.type === "content" && content.content.type === "text"
                ? content.content.text
                : "",
        )
        .join("");
}

describe("proposal.0001 tools outside the roster", () => {
    test.each(["eval", "task"])(
        "a call to %s is reported as a failed tool call and the turn carries on",
        async toolName => {
            const session = await startPicoSession([
                { content: [{ type: "toolCall", name: toolName, arguments: { i: "try it" } }] },
                { content: ["Never mind."] },
            ]);

            const response = await session.prompt("use a tool Pico does not offer");

            expect(response.stopReason).toBe("end_turn");
            const opened = session.updates().filter(update => update.sessionUpdate === "tool_call");
            expect(opened).toHaveLength(1);
            expect(opened[0]?.name).toBe(toolName);

            const ended = endOf(session.updates(), opened[0]?.toolCallId as string);
            expect(ended.status).toBe("failed");
            expect(textOf(ended)).toContain(toolName);
        },
        30_000,
    );
});
