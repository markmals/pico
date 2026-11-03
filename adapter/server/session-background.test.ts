import type { NewSessionResponse, PromptResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type { MockResponse } from "@oh-my-pi/pi-ai/providers/mock";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { toolCall } from "../engine/testing/session-fixture.ts";
import { assistantText, connectPicoAgent, requestError } from "./agent-harness.ts";
import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { fakeSession } from "./fake-session.ts";
import { picoAgentShutdown } from "./pico-agent.ts";
import {
    closeOpenConnections,
    isRunning,
    settle,
    startPicoSession,
    waitUntil,
} from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

function statusesFor(updates: SessionUpdate[], toolCallId: string): (string | null | undefined)[] {
    return updates
        .filter(update => update.sessionUpdate === "tool_call_update")
        .filter(update => update.toolCallId === toolCallId)
        .map(update => update.status);
}

/** The given responses, then a plain answer for every later model call. */
function* scripted(...responses: MockResponse[]): Generator<MockResponse> {
    yield* responses;
    while (true) yield { content: ["Done."] };
}

/**
 * A background job whose process ignores SIGTERM, as a server that traps it would. It publishes
 * its process id first, so the test can watch the process OMP's first signal leaves running.
 */
function stubbornJob(pidFile: string, id: string) {
    return toolCall(
        "bash",
        {
            command: `/bin/sh -c 'trap "" TERM; echo $$ > ${pidFile}; exec /bin/sleep 30'`,
            async: true,
        },
        id,
    );
}

async function pidFrom(file: string): Promise<number> {
    expect(
        await waitUntil(() => existsSync(file) && readFileSync(file, "utf8").trim() !== ""),
    ).toBe(true);
    return Number(readFileSync(file, "utf8").trim());
}

describe("proposal.0008 a turn owns its background jobs", () => {
    test("the turn ends only after its job and the run the job wakes, whose tool calls are reported", async () => {
        const session = await startPicoSession(
            scripted(
                {
                    content: [
                        toolCall(
                            "bash",
                            { command: "/bin/sleep 1; echo job-output", async: true },
                            "job",
                        ),
                    ],
                },
                { content: ["I'll be woken when it finishes."] },
                { content: [toolCall("bash", { command: "echo woken" }, "after-job")] },
                { content: ["All done."] },
            ),
        );

        const response = await session.prompt("run it in the background");

        expect(response.stopReason).toBe("end_turn");
        const updates = session.updates();
        expect(statusesFor(updates, "job").at(-1)).toBe("completed");
        expect(statusesFor(updates, "after-job").at(-1)).toBe("completed");
        expect(assistantText(updates)).toContain("All done.");
    }, 30_000);

    test("a job the agent waits for wakes no second run, and the wait completes", async () => {
        const session = await startPicoSession(
            scripted(
                {
                    content: [
                        toolCall(
                            "bash",
                            { command: "/bin/sleep 1; echo job-output", async: true },
                            "job",
                        ),
                    ],
                },
                { content: [toolCall("wait", {}, "wait")] },
                { content: ["Waited."] },
            ),
        );

        const response = await session.prompt("run it and wait");
        await settle(500);

        expect(response.stopReason).toBe("end_turn");
        expect(statusesFor(session.updates(), "wait").at(-1)).toBe("completed");
        expect(session.model.calls.length).toBe(3);
    }, 30_000);

    test("a run woken by a job that fails stops the remaining jobs and fails the turn", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "slow.pid");
        const session = await startPicoSession(
            scripted(
                {
                    content: [
                        toolCall("bash", { command: "/bin/sleep 1", async: true }, "quick"),
                        stubbornJob(pidFile, "slow"),
                    ],
                },
                { content: ["Waiting for both."] },
                { stopReason: "error", errorMessage: "provider exploded" },
            ),
            { cwd },
        );

        const error = await requestError(session.prompt("run two jobs"));

        expect(error.message).toContain("provider exploded");
        expect(isRunning(await pidFrom(pidFile))).toBe(false);
        expect(statusesFor(session.updates(), "slow").at(-1)).toBe("failed");
    }, 30_000);

    test("a turn that fails while its job runs stops the job", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "slow.pid");
        // The model fails only once the job is running, so there is a process to watch.
        async function* script(): AsyncGenerator<MockResponse> {
            yield { content: [stubbornJob(pidFile, "slow")] };
            await pidFrom(pidFile);
            yield { stopReason: "error", errorMessage: "provider exploded" };
            yield* scripted();
        }
        const session = await startPicoSession(script(), { cwd });

        const error = await requestError(session.prompt("run a job"));

        expect(error.message).toContain("provider exploded");
        expect(isRunning(await pidFrom(pidFile))).toBe(false);
    }, 30_000);
});

describe("proposal.0008 stopping a turn's background jobs", () => {
    test("Stop kills the job, even one ignoring SIGTERM, fails its call, and the next prompt runs", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "slow.pid");
        const session = await startPicoSession(
            scripted({ content: [stubbornJob(pidFile, "slow")] }, { content: ["Waiting for it."] }),
            { cwd },
        );

        const running = session.prompt("run a job");
        const pid = await pidFrom(pidFile);
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "agent_message_chunk",
        );
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        expect(isRunning(pid)).toBe(false);
        expect(statusesFor(session.updates(), "slow").at(-1)).toBe("failed");
        expect((await session.prompt("are you there?")).stopReason).toBe("end_turn");
    }, 30_000);

    test("Stop during a wait kills the job and fails the wait", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "slow.pid");
        const session = await startPicoSession(
            scripted(
                { content: [stubbornJob(pidFile, "slow")] },
                { content: [toolCall("wait", {}, "wait")] },
            ),
            { cwd },
        );

        const running = session.prompt("run a job and wait");
        const pid = await pidFrom(pidFile);
        await session.client.waitForUpdate(
            session.sessionId,
            update => update.sessionUpdate === "tool_call" && update.toolCallId === "wait",
        );
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        expect(isRunning(pid)).toBe(false);
        expect(statusesFor(session.updates(), "wait").at(-1)).toBe("failed");
    }, 30_000);

    test("disconnecting kills every job before shutdown completes", async () => {
        const cwd = temporaryProject();
        const pidFile = join(cwd, "slow.pid");
        const session = await startPicoSession(
            scripted({ content: [stubbornJob(pidFile, "slow")] }, { content: ["Waiting for it."] }),
            { cwd },
        );

        void session.prompt("run a job").catch(() => {});
        const pid = await pidFrom(pidFile);
        await session.client.close();
        await picoAgentShutdown(session.client.app).completed;

        expect(isRunning(pid)).toBe(false);
    }, 30_000);
});

describe("proposal.0008 a cancellation that cannot stop a background job", () => {
    test("the turn ends cancelled and the session is closed", async () => {
        const cwd = temporaryProject();
        const aborted = Promise.withResolvers<boolean>();
        const fake = fakeSession(cwd, {
            prompt: () => aborted.promise,
            abort: () => {
                aborted.resolve(true);
                return Promise.resolve();
            },
            stopBackgroundJobs: () => Promise.resolve(false),
        });
        const client = connectPicoAgent({
            version: "0.0.0-test",
            createSession: () => Promise.resolve(fake.session),
        });
        await client.initialize();
        const created = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        const prompt = (text: string) =>
            client.agent.request("session/prompt", {
                sessionId: created.sessionId,
                prompt: [{ type: "text", text }],
            }) as Promise<PromptResponse>;

        const running = prompt("run a job that will not stop");
        await client.agent.notify("session/cancel", { sessionId: created.sessionId });
        const response = await running;

        expect(response.stopReason).toBe("cancelled");
        expect(fake.disposals).toBe(1);
        const error = await requestError(prompt("anyone there?"));
        expect(error.message).toMatch(/closed/i);

        await client.close();
    }, 20_000);
});
