import {
    client,
    ndJsonStream,
    type ClientContext,
    type SessionUpdate,
    type StopReason,
} from "@agentclientprotocol/sdk";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Checklist } from "./checklist.ts";
import { runningPids, waitUntil } from "./processes.ts";
import {
    agentText,
    collectToolCalls,
    commandCallProblem,
    commandExitCodeProblem,
    commandOutputProblem,
    commandTitleProblem,
    editCallProblem,
    readCallProblem,
} from "./tool-calls.ts";
import { acpMessageProblem, inspectLines } from "./wire.ts";

const SMOKE_FILE = "pico-smoke.txt";
const SMOKE_TEXT = "hello from pico";
const CAT_COMMAND = `cat ${SMOKE_FILE}`;
const FAILING_EXIT_CODE = 3;
const FAILING_COMMAND = `exit ${FAILING_EXIT_CODE}`;
// What Oh My Pi puts in the tool call's text, and what the guide's worked example promises.
const FAILING_EXIT_TEXT = `Command exited with code ${FAILING_EXIT_CODE}`;
// An external binary with a distinctive duration, not a bare `sleep`: Oh My Pi's embedded
// shell runs some commands in-process, and a cancellation that only interrupts a builtin
// would not show that a running subprocess is killed.
const LONG_COMMAND = "/bin/sleep 613";

// A real model needs the steps spelled out, including which tool to use, or it answers from
// memory, batches the work into one command, or tidies up after a failure.
const WRITE_READ_RUN_PROMPT = [
    "Do exactly these three steps, in this order, and nothing else.",
    `1. Use the write tool to create a file named ${SMOKE_FILE} in the current working directory, containing exactly one line: ${SMOKE_TEXT}`,
    `2. Use the read tool to read ${SMOKE_FILE} back.`,
    `3. Use the bash tool to run exactly this command: ${CAT_COMMAND}`,
    "Then reply with one short sentence saying that you did all three steps.",
].join("\n");

const FAILING_COMMAND_PROMPT = [
    `Use the bash tool to run exactly this command, once: ${FAILING_COMMAND}`,
    "The command is meant to fail. Do not investigate the failure, do not retry it, and do not run any other command.",
    "Then reply with one short sentence saying that the command failed.",
].join("\n");

const LONG_COMMAND_PROMPT = [
    `Use the bash tool to run exactly this command, once: ${LONG_COMMAND}`,
    "Wait for it to finish. Do not run it in the background, do not shorten it, and do not run any other command.",
].join("\n");

const CLOSING_PROMPT = "Reply with exactly the word: done. Do not use any tool.";

// The engine gives a killed command a 1 s grace period and Pico gives the abort 5 s before it
// gives up on the session, so a cancellation that works resolves well inside this.
const CANCEL_SECONDS = 10;

// A tool call is reported as execution starts, so the process it spawns appears a moment
// later; after the turn resolves, the kill has already been waited for.
const COMMAND_SIGHTING_SECONDS = 5;
const COMMAND_EXIT_SECONDS = 10;

interface Turn {
    stopReason: StopReason;
    updates: SessionUpdate[];
}

interface Smoke {
    checklist: Checklist;
    updates: SessionUpdate[];
    watchers: Array<(update: SessionUpdate) => void>;
    workspace: string;
}

/** One prompt turn at a time in one session, with the updates that turn produced. */
class Turns {
    #context: ClientContext;
    #sessionId: string;
    #updates: SessionUpdate[];

    constructor(context: ClientContext, sessionId: string, updates: SessionUpdate[]) {
        this.#context = context;
        this.#sessionId = sessionId;
        this.#updates = updates;
    }

    async run(prompt: string, seconds: number): Promise<Turn> {
        let from = this.#updates.length;
        let response = await withDeadline(
            this.#context.request("session/prompt", {
                sessionId: this.#sessionId,
                prompt: [{ type: "text", text: prompt }],
            }),
            seconds,
            "session/prompt",
        );
        return { stopReason: response.stopReason, updates: this.#updates.slice(from) };
    }

    async cancel(): Promise<void> {
        await this.#context.notify("session/cancel", { sessionId: this.#sessionId });
    }
}

async function checkInitialize(context: ClientContext, checklist: Checklist): Promise<void> {
    let response = await withDeadline(
        context.request("initialize", {
            protocolVersion: 1,
            clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
            },
            clientInfo: { name: "pico-smoke", version: "0" },
        }),
        60,
        "initialize",
    );

    let capabilities = response.agentCapabilities ?? {};
    let prompt = capabilities.promptCapabilities ?? {};
    let mcp = capabilities.mcpCapabilities ?? {};
    let claims: string[] = [];

    if (response.protocolVersion !== 1) claims.push(`protocolVersion ${response.protocolVersion}`);
    if (response.agentInfo?.name !== "pico")
        claims.push(`agentInfo.name ${response.agentInfo?.name}`);
    if (capabilities.loadSession === true) claims.push("loadSession");
    if (prompt.image === true) claims.push("promptCapabilities.image");
    if (prompt.audio === true) claims.push("promptCapabilities.audio");
    if (prompt.embeddedContext === true) claims.push("promptCapabilities.embeddedContext");
    if (mcp.http === true) claims.push("mcpCapabilities.http");
    if (mcp.sse === true) claims.push("mcpCapabilities.sse");

    checklist.record(
        "initialize claims only what Pico implements",
        claims.length === 0 ? null : claims.join(", "),
    );
}

async function checkWriteReadRun(turns: Turns, smoke: Smoke): Promise<void> {
    let turn = await turns.run(WRITE_READ_RUN_PROMPT, 300);
    let calls = collectToolCalls(turn.updates);
    let file = path.join(smoke.workspace, SMOKE_FILE);
    let { checklist } = smoke;

    checklist.record(
        "the turn streams assistant text",
        agentText(turn.updates).trim() === "" ? "no agent_message_chunk carried text" : null,
    );
    checklist.record(
        `writing ${SMOKE_FILE} is a completed edit tool call with a diff`,
        editCallProblem(calls, file, SMOKE_TEXT),
    );
    checklist.record(
        `reading ${SMOKE_FILE} is a completed read tool call`,
        readCallProblem(calls, file),
    );
    checklist.record(
        `\`${CAT_COMMAND}\` is a completed execute tool call`,
        commandCallProblem(calls, CAT_COMMAND, "completed"),
    );
    checklist.record(
        `the \`${CAT_COMMAND}\` tool call is titled with its command`,
        commandTitleProblem(calls, CAT_COMMAND),
    );
    checklist.record(
        `\`${CAT_COMMAND}\` reports what was written`,
        commandOutputProblem(calls, CAT_COMMAND, SMOKE_TEXT),
    );
    checklist.record("the turn ends with end_turn", stopReasonProblem(turn, "end_turn"));
}

async function checkFailingCommand(turns: Turns, checklist: Checklist): Promise<void> {
    let turn = await turns.run(FAILING_COMMAND_PROMPT, 300);
    let calls = collectToolCalls(turn.updates);

    checklist.record(
        `\`${FAILING_COMMAND}\` is a failed execute tool call`,
        commandCallProblem(calls, FAILING_COMMAND, "failed"),
    );
    checklist.record(
        `\`${FAILING_COMMAND}\` reports its exit code in rawOutput`,
        commandExitCodeProblem(calls, FAILING_COMMAND, FAILING_EXIT_CODE),
    );
    checklist.record(
        `\`${FAILING_COMMAND}\` names its exit code in the tool call's text`,
        commandOutputProblem(calls, FAILING_COMMAND, FAILING_EXIT_TEXT),
    );
}

async function checkCancellation(turns: Turns, smoke: Smoke): Promise<void> {
    let { promise: started, resolve: commandStarted } = Promise.withResolvers<void>();
    let watcher = (update: SessionUpdate) => {
        if (update.sessionUpdate === "tool_call" && update.kind === "execute") commandStarted();
    };
    smoke.watchers.push(watcher);

    let running = turns.run(LONG_COMMAND_PROMPT, 300);
    let startedFirst = await Promise.race([started.then(() => true), running.then(() => false)]);

    let spawned = false;
    let cancelledAt = 0;
    if (startedFirst) {
        spawned = await waitUntil(
            COMMAND_SIGHTING_SECONDS,
            () => runningPids(LONG_COMMAND).length > 0,
        );
        cancelledAt = Date.now();
        await turns.cancel();
    }

    let turn = await running;
    smoke.watchers.splice(smoke.watchers.indexOf(watcher), 1);

    let spawns = `\`${LONG_COMMAND}\` runs as a real process`;
    let stopped = `cancelling \`${LONG_COMMAND}\` ends the turn cancelled`;
    let promptly = `the cancelled turn resolves within ${CANCEL_SECONDS} seconds`;
    let killed = `the cancelled process is gone within ${COMMAND_EXIT_SECONDS} seconds`;
    if (!startedFirst) {
        let unstarted = "the turn ended before any execute tool call appeared";
        for (let check of [spawns, stopped, promptly, killed]) {
            smoke.checklist.record(check, unstarted);
        }
        return;
    }

    let seconds = (Date.now() - cancelledAt) / 1000;
    let gone = await waitUntil(COMMAND_EXIT_SECONDS, () => runningPids(LONG_COMMAND).length === 0);

    smoke.checklist.record(
        spawns,
        spawned ? null : `no process ran \`${LONG_COMMAND}\` while its tool call was in flight`,
    );
    smoke.checklist.record(stopped, stopReasonProblem(turn, "cancelled"));
    smoke.checklist.record(
        promptly,
        seconds <= CANCEL_SECONDS ? null : `took ${seconds.toFixed(1)} seconds`,
    );
    smoke.checklist.record(
        killed,
        gone ? null : `${runningPids(LONG_COMMAND).join(", ")} still ran \`${LONG_COMMAND}\``,
    );
}

async function checkPromptAfterCancellation(turns: Turns, checklist: Checklist): Promise<void> {
    let turn = await turns.run(CLOSING_PROMPT, 120);
    checklist.record(
        "the next prompt after a cancellation completes",
        stopReasonProblem(turn, "end_turn"),
    );
}

async function drive(context: ClientContext, smoke: Smoke): Promise<void> {
    await checkInitialize(context, smoke.checklist);

    let session = await withDeadline(
        context.request("session/new", { cwd: smoke.workspace, mcpServers: [] }),
        120,
        "session/new",
    );
    let turns = new Turns(context, session.sessionId, smoke.updates);

    await checkWriteReadRun(turns, smoke);
    await checkFailingCommand(turns, smoke.checklist);
    await checkCancellation(turns, smoke);
    await checkPromptAfterCancellation(turns, smoke.checklist);
}

function stopReasonProblem(turn: Turn, expected: StopReason): string | null {
    return turn.stopReason === expected ? null : `stopReason was ${turn.stopReason}`;
}

function subprocessInput(sink: Bun.FileSink): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
        async write(chunk) {
            sink.write(chunk);
            await sink.flush();
        },
        close() {
            sink.end();
        },
    });
}

async function withDeadline<T>(work: Promise<T>, seconds: number, what: string): Promise<T> {
    let { promise: deadline, reject } = Promise.withResolvers<never>();
    let timer = setTimeout(
        () => reject(new Error(`${what} did not answer within ${seconds} seconds`)),
        seconds * 1000,
    );
    try {
        return await Promise.race([work, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

function fail(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

async function main(): Promise<void> {
    let launcher = path.resolve(import.meta.dirname, "..", "..", ".build", "pico-acp");
    if (!existsSync(launcher)) {
        fail(`${launcher} does not exist. Run \`mise run acp:launcher\` first.`);
    }

    // The real path, because the tool calls report the paths the engine resolved and macOS
    // hands out temporary directories under a symlink.
    let workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-smoke-")));
    let smoke: Smoke = { checklist: new Checklist(), updates: [], watchers: [], workspace };
    let strayLines: string[] = [];
    let permissionRequests = 0;

    let agent = Bun.spawn({
        cmd: [launcher],
        cwd: workspace,
        env: process.env,
        stderr: "inherit",
        stdin: "pipe",
        stdout: "pipe",
    });

    let app = client({ name: "pico-smoke" })
        .onRequest("session/request_permission", () => {
            permissionRequests += 1;
            return { outcome: { outcome: "cancelled" } };
        })
        .onNotification("session/update", ({ params }) => {
            smoke.updates.push(params.update);
            for (let watcher of smoke.watchers) watcher(params.update);
        });

    let stream = ndJsonStream(
        subprocessInput(agent.stdin),
        inspectLines(agent.stdout, line => {
            let problem = acpMessageProblem(line);
            if (problem !== null) strayLines.push(`${problem}: ${line.slice(0, 120)}`);
        }),
    );

    try {
        await app.connectWith(stream, context => drive(context, smoke));
    } catch (error) {
        smoke.checklist.record(
            "the smoke run completes",
            error instanceof Error ? error.message : String(error),
        );
    } finally {
        agent.kill();
        await agent.exited;
        rmSync(workspace, { force: true, recursive: true });
    }

    smoke.checklist.record(
        "stdout carries ACP messages only",
        strayLines.length === 0 ? null : strayLines.join("; "),
    );
    smoke.checklist.record(
        "no session/request_permission arrives",
        permissionRequests === 0 ? null : `${permissionRequests} arrived`,
    );

    process.stdout.write(`${smoke.checklist.report()}\n`);
    if (!smoke.checklist.passed) fail("acp:smoke found failing checks.");
}

if (import.meta.main) await main();
