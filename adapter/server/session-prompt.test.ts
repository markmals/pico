import type { ContentBlock } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { assistantText, INVALID_PARAMS, requestError } from "./agent-harness.ts";
import { removeTemporaryDirectories } from "./engine-harness.ts";
import {
    closeOpenConnections,
    settle,
    startPicoSession,
    updateKinds,
    userText,
} from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

describe("proposal.0001 session/prompt content", () => {
    test("text blocks reach the model in the order they were sent", async () => {
        const session = await startPicoSession([{ content: ["ok"] }]);

        await session.prompt([
            { type: "text", text: "first instruction" },
            { type: "text", text: "second instruction" },
        ]);

        const text = userText(session.model);
        expect(text).toContain("first instruction");
        expect(text).toContain("second instruction");
        expect(text.indexOf("first instruction")).toBeLessThan(text.indexOf("second instruction"));
    });

    test("a resource link becomes a text reference naming the link", async () => {
        const session = await startPicoSession([{ content: ["ok"] }]);

        await session.prompt([
            { type: "text", text: "look at this" },
            {
                type: "resource_link",
                name: "config.toml",
                uri: "file:///workspace/config.toml",
                title: "Project configuration",
                description: "Build settings for the project",
            },
        ]);

        const text = userText(session.model);
        expect(text).toContain("config.toml");
        expect(text).toContain("file:///workspace/config.toml");
        expect(text).toContain("Project configuration");
        expect(text).toContain("Build settings for the project");
    });

    test.each<[string, ContentBlock]>([
        ["image", { type: "image", data: "aGk=", mimeType: "image/png" }],
        ["audio", { type: "audio", data: "aGk=", mimeType: "audio/wav" }],
        [
            "resource",
            {
                type: "resource",
                resource: { uri: "file:///workspace/a.txt", text: "hi", mimeType: "text/plain" },
            },
        ],
    ])("a %s block is rejected and never reaches the model", async (blockType, block) => {
        const session = await startPicoSession([{ content: ["ok"] }]);

        const error = await requestError(session.prompt([{ type: "text", text: "look" }, block]));

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain(blockType);
        expect(session.model.calls).toHaveLength(0);
    });
});

describe("proposal.0001 session/prompt turn admission", () => {
    test("a prompt for an unknown session is rejected", async () => {
        const session = await startPicoSession([{ content: ["ok"] }]);

        const error = await requestError(
            session.client.agent.request("session/prompt", {
                sessionId: "no-such-session",
                prompt: [{ type: "text", text: "hello" }],
            }),
        );

        expect(error.code).toBe(INVALID_PARAMS);
    });

    test("a second prompt is rejected while a turn runs, and the running turn finishes", async () => {
        const reachedModel = Promise.withResolvers<void>();
        const session = await startPicoSession([
            () => {
                reachedModel.resolve();
                return { content: ["slow answer"], delayMs: 500 };
            },
        ]);

        const running = session.prompt("first");
        await reachedModel.promise;
        const error = await requestError(session.prompt("second"));

        expect(error.message).toContain("already running");
        expect((await running).stopReason).toBe("end_turn");
        expect(assistantText(session.updates())).toBe("slow answer");
    });
});

describe("proposal.0001 session/prompt update ordering", () => {
    test("every update of a turn is delivered before the prompt response", async () => {
        const session = await startPicoSession([
            {
                content: [
                    { type: "thinking", thinking: "planning" },
                    "Writing the file.",
                    {
                        type: "toolCall",
                        name: "write",
                        arguments: { path: "a.txt", content: "hi\n" },
                    },
                ],
            },
            { content: ["Done."] },
        ]);

        await session.prompt("write a file");
        const deliveredWithResponse = session.updates().length;
        await settle();

        const updates = session.updates();
        expect(updates).toHaveLength(deliveredWithResponse);

        const kinds = updateKinds(updates);
        expect(kinds).toContain("tool_call");
        expect(kinds.indexOf("agent_thought_chunk")).toBeLessThan(
            kinds.indexOf("agent_message_chunk"),
        );
        expect(kinds.indexOf("tool_call")).toBeLessThan(kinds.lastIndexOf("tool_call_update"));
    });

    test("a turn advertises no commands and carries no vendor metadata", async () => {
        const session = await startPicoSession([{ content: ["ok"] }]);

        await session.prompt("hello");

        const notifications = session.client.notifications;
        expect(notifications.length).toBeGreaterThan(0);
        expect(updateKinds(notifications.map(entry => entry.update))).not.toContain(
            "available_commands_update",
        );
        expect(notifications.some(entry => entry._meta !== undefined && entry._meta !== null)).toBe(
            false,
        );
    });
});
