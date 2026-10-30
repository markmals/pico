import type { NewSessionResponse, PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type { MockResponse } from "@oh-my-pi/pi-ai/providers/mock";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";
import type { ConnectedClient } from "./agent-harness.ts";

import { connectPicoAgent, requestError } from "./agent-harness.ts";
import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { fakeSession, neverSettles } from "./fake-session.ts";
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

describe("proposal.0001 a cancellation the engine does not answer", () => {
    interface Connected {
        client: ConnectedClient;
        sessionId: string;
        prompt(text: string): Promise<PromptResponse>;
    }

    async function connect(session: PicoSession, cwd: string): Promise<Connected> {
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        return {
            client,
            sessionId: created.sessionId,
            prompt: text =>
                client.agent.request("session/prompt", {
                    sessionId: created.sessionId,
                    prompt: [{ type: "text", text }],
                }) as Promise<PromptResponse>,
        };
    }

    test("an abort that never settles ends the turn cancelled and closes the session", async () => {
        const cwd = temporaryProject();
        const fake = fakeSession(cwd);
        const connected = await connect(fake.session, cwd);

        const running = connected.prompt("hang");
        await connected.client.agent.notify("session/cancel", { sessionId: connected.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        expect(fake.disposals).toBe(1);

        const error = await requestError(connected.prompt("anyone there?"));
        expect(error.message).toMatch(/closed/i);
        expect(error.message).toMatch(/cancel/i);

        await connected.client.close();
    }, 20_000);

    test("a turn stays reserved while its cancellation is still unwinding", async () => {
        const cwd = temporaryProject();
        // The engine answers the prompt the moment the abort starts, and keeps
        // unwinding afterwards. Releasing the turn here would let a second prompt
        // start on a session the expiring cancellation is about to dispose.
        const aborting = Promise.withResolvers<void>();
        const fake = fakeSession(cwd, {
            prompt: async () => {
                await aborting.promise;
                return true;
            },
            abort: () => {
                aborting.resolve();
                return neverSettles<void>();
            },
        });
        const connected = await connect(fake.session, cwd);

        const running = connected.prompt("start something");
        await connected.client.agent.notify("session/cancel", { sessionId: connected.sessionId });
        await settle(300);

        const refusal = await requestError(connected.prompt("meanwhile"));
        expect(refusal.message).toContain("already running");
        expect((await running).stopReason).toBe("cancelled");

        await connected.client.close();
    }, 20_000);

    test("an abort that fails is a failed cancellation", async () => {
        const cwd = temporaryProject();
        const fake = fakeSession(cwd, { abort: () => Promise.reject(new Error("abort exploded")) });
        const connected = await connect(fake.session, cwd);

        const running = connected.prompt("hang");
        await connected.client.agent.notify("session/cancel", { sessionId: connected.sessionId });

        expect((await running).stopReason).toBe("cancelled");
        expect(fake.disposals).toBe(1);

        const error = await requestError(connected.prompt("anyone there?"));
        expect(error.message).toMatch(/closed/i);

        await connected.client.close();
    }, 10_000);

    test("an abort that stops nothing is a failed cancellation", async () => {
        const cwd = temporaryProject();
        // The engine accepts the abort but never ends the turn it was told to stop.
        const fake = fakeSession(cwd, { abort: () => Promise.resolve() });
        const connected = await connect(fake.session, cwd);

        const running = connected.prompt("hang");
        await connected.client.agent.notify("session/cancel", { sessionId: connected.sessionId });

        expect((await running).stopReason).toBe("cancelled");
        expect(fake.disposals).toBe(1);

        const error = await requestError(connected.prompt("anyone there?"));
        expect(error.message).toMatch(/closed/i);

        await connected.client.close();
    }, 20_000);

    test("a disposal that stalls does not hold up the cancelled response", async () => {
        const cwd = temporaryProject();
        const fake = fakeSession(cwd, { dispose: () => neverSettles<void>() });
        const connected = await connect(fake.session, cwd);

        const running = connected.prompt("hang");
        await connected.client.agent.notify("session/cancel", { sessionId: connected.sessionId });

        expect((await running).stopReason).toBe("cancelled");
        expect(fake.disposals).toBe(1);

        await connected.client.close();
    }, 20_000);
});
