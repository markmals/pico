import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { Context } from "@oh-my-pi/pi-ai";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { closeOpenConnections, startPicoSession } from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

/** The hashline tag the `read` tool just handed the model, which `edit` must echo back. */
function hashlineTagFrom(context: Context, fileName: string): string {
    for (const message of context.messages.toReversed()) {
        if (message.role !== "toolResult") continue;
        const text = message.content
            .map(block => (block.type === "text" ? block.text : ""))
            .join("");
        const tag = new RegExp(`\\[${fileName}#([0-9A-Fa-f]{4})\\]`).exec(text);
        if (tag) return tag[1] as string;
    }
    throw new Error(`no hashline tag for ${fileName} in the conversation`);
}

describe("proposal.0001 approvals", () => {
    test("a turn that writes, edits and runs a command never asks for permission", async () => {
        const cwd = temporaryProject();
        writeFileSync(join(cwd, "notes.txt"), "one\ntwo\nthree\n");

        const session = await startPicoSession(
            [
                {
                    content: [
                        {
                            type: "toolCall",
                            name: "write",
                            arguments: { path: "a.txt", content: "hi\n" },
                        },
                    ],
                },
                { content: [{ type: "toolCall", name: "read", arguments: { path: "notes.txt" } }] },
                (context: Context) => ({
                    content: [
                        {
                            type: "toolCall" as const,
                            name: "edit",
                            arguments: {
                                input: `[notes.txt#${hashlineTagFrom(context, "notes\\.txt")}]\nPUT 2.=2:\n+TWO`,
                            },
                        },
                    ],
                }),
                {
                    content: [
                        { type: "toolCall", name: "bash", arguments: { command: "cat a.txt" } },
                    ],
                },
                { content: ["Done."] },
            ],
            { cwd },
        );

        const response = await session.prompt("write, edit and run something");

        expect(session.client.permissionRequests).toEqual([]);
        expect(response.stopReason).toBe("end_turn");
        expect(terminalStatuses(session.updates())).toEqual([
            "completed",
            "completed",
            "completed",
            "completed",
        ]);
    });
});

function terminalStatuses(updates: SessionUpdate[]): string[] {
    return updates
        .filter(update => update.sessionUpdate === "tool_call_update")
        .map(update => update.status)
        .filter(status => status === "completed" || status === "failed");
}
