import type { SessionUpdate, ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { closeOpenConnections, startPicoSession } from "./session-fixture.ts";

const STUB_MCP_SERVER = join(import.meta.dir, "stub-mcp-server.fixture.ts");

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

function openedCall(updates: SessionUpdate[]): ToolCall {
    const opened = updates.find(update => update.sessionUpdate === "tool_call");
    if (!opened) throw new Error("no tool call was reported");
    return opened;
}

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

describe("proposal.0001 MCP tools a host server supplies", () => {
    test("a call to a Sesh tool is reported by server and tool name and completes with its result", async () => {
        const cwd = temporaryProject();
        const session = await startPicoSession(
            [
                {
                    content: [
                        {
                            type: "toolCall",
                            name: "mcp__sesh_ask_user",
                            arguments: { question: "Which one?" },
                        },
                    ],
                },
                { content: ["Thanks."] },
            ],
            {
                cwd,
                mcpServers: [
                    {
                        name: "sesh",
                        command: process.execPath,
                        args: [STUB_MCP_SERVER, join(cwd, "mcp-server.pid")],
                        env: [],
                    },
                ],
            },
        );

        const response = await session.prompt("ask me something");

        expect(response.stopReason).toBe("end_turn");
        const opened = openedCall(session.updates());
        expect(opened.name).toBe("mcp__sesh_ask_user");
        expect(opened.title).toBe("sesh: ask_user");
        expect(opened.kind).toBe("other");

        const ended = endOf(session.updates(), opened.toolCallId);
        expect(ended.status).toBe("completed");
        expect(textOf(ended)).toContain("ask_user answered");
        expect(textOf(ended)).toContain("Which one?");
    }, 30_000);
});
