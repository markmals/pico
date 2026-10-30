import type { NewSessionResponse, PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type { MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";

import { connectPicoAgent, requestError } from "./agent-harness.ts";
import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { closeOpenConnections, settle, startPicoSession, userText } from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

function toolCallIdOf(updates: SessionUpdate[]): string {
    const opened = updates.find(update => update.sessionUpdate === "tool_call");
    if (!opened) throw new Error("no tool call was reported");
    return opened.toolCallId;
}

function statusesFor(updates: SessionUpdate[], toolCallId: string): (string | null | undefined)[] {
    return updates
        .filter(update => update.sessionUpdate === "tool_call_update")
        .filter(update => update.toolCallId === toolCallId)
        .map(update => update.status);
}

/**
 * The opening response, then a plain answer for every later model call. An abort
 * lands on whatever request the engine had already started, so the number of
 * calls a cancelled turn consumes is not part of what these tests assert.
 */
function* scripted(first: MockResponse): Generator<MockResponse> {
    yield first;
    while (true) yield { content: ["Done."] };
}

describe("proposal.0001 session/cancel", () => {
    test("cancelling kills the running command, fails its tool call and ends the turn cancelled", async () => {
        const cwd = temporaryProject();
        const session = await startPicoSession(
            scripted({
                content: [
                    {
                        type: "toolCall",
                        name: "bash",
                        arguments: { command: "sleep 2 && touch finished-anyway.txt" },
                    },
                ],
            }),
            { cwd },
        );

        const running = session.prompt("run something long");
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "tool_call",
        );
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        const toolCallId = toolCallIdOf(session.updates());
        expect(statusesFor(session.updates(), toolCallId).at(-1)).toBe("failed");

        await settle(3_000);
        expect(existsSync(join(cwd, "finished-anyway.txt"))).toBe(false);
    }, 20_000);

    test("the next prompt runs and keeps the cancelled turn in its conversation", async () => {
        const session = await startPicoSession(
            scripted({
                content: [
                    "Starting.",
                    { type: "toolCall", name: "bash", arguments: { command: "sleep 2" } },
                ],
            }),
        );

        const running = session.prompt("the first request");
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "tool_call",
        );
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });
        await running;

        const second = await session.prompt("the second request");

        expect(second.stopReason).toBe("end_turn");
        const conversation = userText(session.model);
        expect(conversation).toContain("the first request");
        expect(conversation).toContain("the second request");
    }, 20_000);

    test("a repeated cancel during the same turn is ignored", async () => {
        const session = await startPicoSession(
            scripted({
                content: [{ type: "toolCall", name: "bash", arguments: { command: "sleep 2" } }],
            }),
        );

        const running = session.prompt("run something long");
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "tool_call",
        );
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });

        expect((await running).stopReason).toBe("cancelled");
        expect((await session.prompt("try again")).stopReason).toBe("end_turn");
    }, 20_000);

    test("a cancel for an unknown session is ignored", async () => {
        const session = await startPicoSession([{ content: ["still here"] }]);

        await session.client.agent.notify("session/cancel", { sessionId: "no-such-session" });

        expect((await session.prompt("hello")).stopReason).toBe("end_turn");
    });

    test("a cancel for a session with no running turn is ignored", async () => {
        const session = await startPicoSession([{ content: ["still here"] }]);

        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });

        expect((await session.prompt("hello")).stopReason).toBe("end_turn");
    });
});

describe("proposal.0001 a cancellation that cannot stop the engine", () => {
    /** An engine whose abort never settles: no scripted model can produce that. */
    function unstoppableSession(cwd: string): { session: PicoSession; disposals: number } {
        const counters = { disposals: 0 };
        const engine = {
            subscribe: () => () => {},
            prompt: () => Promise.withResolvers<boolean>().promise,
            abort: () => Promise.withResolvers<void>().promise,
            dispose: () => Promise.withResolvers<void>().promise,
        } as unknown as AgentSession;
        const session: PicoSession = {
            engine,
            cwd,
            takeRecordedWrite: () => undefined,
            dispose: async () => {
                counters.disposals++;
            },
        };
        return {
            session,
            get disposals() {
                return counters.disposals;
            },
        };
    }

    test("the turn ends cancelled, the session is disposed, and later prompts say so", async () => {
        const cwd = temporaryProject();
        const unstoppable = unstoppableSession(cwd);
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(unstoppable.session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;

        const running = client.agent.request("session/prompt", {
            sessionId: created.sessionId,
            prompt: [{ type: "text", text: "hang" }],
        }) as Promise<PromptResponse>;
        await client.agent.notify("session/cancel", { sessionId: created.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        expect(unstoppable.disposals).toBe(1);

        const error = await requestError(
            client.agent.request("session/prompt", {
                sessionId: created.sessionId,
                prompt: [{ type: "text", text: "anyone there?" }],
            }),
        );
        expect(error.message).toMatch(/closed/i);
        expect(error.message).toMatch(/cancel/i);

        await client.close();
    }, 20_000);
});
