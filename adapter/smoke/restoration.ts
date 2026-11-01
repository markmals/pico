import type { ClientContext, SessionUpdate } from "@agentclientprotocol/sdk";

import { client, ndJsonStream } from "@agentclientprotocol/sdk";
import { readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Checklist } from "./checklist.ts";
import type { Scratch } from "./verify.ts";

import { subprocessInput } from "./processes.ts";
import { agentText } from "./tool-calls.ts";

export async function verifyRestoration(
    executable: string,
    scratch: Scratch,
    sessionId: string,
    checklist: Checklist,
): Promise<void> {
    const changed = "Changed after the saved turn.\n";
    const file = path.join(scratch.project, "restart-note.txt");
    writeFileSync(file, changed);
    try {
        await inProcess(executable, scratch, async (context, updates) => {
            const listed = await context.request("session/list", {});
            checklist.record(
                "a fresh process lists the same durable session",
                listed.sessions.some(
                    session => session.sessionId === sessionId && session.cwd === scratch.project,
                )
                    ? null
                    : JSON.stringify(listed),
            );
            await context.request("session/load", {
                sessionId,
                cwd: scratch.project,
                mcpServers: [],
            });
            const users = updates.filter(update => update.sessionUpdate === "user_message_chunk");
            const starts = updates.filter(update => update.sessionUpdate === "tool_call");
            const ends = updates.filter(update => update.sessionUpdate === "tool_call_update");
            checklist.record(
                "load replays the saved prompt once",
                users.length === 1 && JSON.stringify(users).includes(scratch.memoryToken)
                    ? null
                    : JSON.stringify(users),
            );
            checklist.record(
                "load replays one completed write card and its saved diff",
                starts.length === 1 &&
                    starts[0]?.toolCallId === "verify-write" &&
                    ends.length === 1 &&
                    ends[0]?.status === "completed" &&
                    ends[0]?.content?.some(
                        content =>
                            content.type === "diff" &&
                            content.oldText === null &&
                            content.newText === `${scratch.memoryToken}\n`,
                    )
                    ? null
                    : JSON.stringify({ starts, ends }),
            );
            checklist.record(
                "load does not repeat the old write",
                readFileSync(file, "utf8") === changed ? null : "loading changed the project file",
            );
            updates.length = 0;
            await recall(context, sessionId);
            checklist.record(
                "a loaded session continues with its saved context",
                agentText(updates) === `remembered:${scratch.memoryToken}`
                    ? null
                    : agentText(updates),
            );
        });
        await inProcess(executable, scratch, async (context, updates) => {
            await context.request("session/resume", { sessionId, cwd: scratch.project });
            checklist.record(
                "resume emits no historical transcript",
                updates.length === 0 ? null : JSON.stringify(updates),
            );
            await recall(context, sessionId);
            checklist.record(
                "a resumed session continues with its saved context",
                agentText(updates) === `remembered:${scratch.memoryToken}`
                    ? null
                    : agentText(updates),
            );
        });
        const parentAlias = path.join(path.dirname(scratch.project), "project-parent-alias");
        symlinkSync(path.dirname(scratch.project), parentAlias, "dir");
        renameSync(scratch.project, `${scratch.project}-removed`);
        await inProcess(executable, { ...scratch, project: scratch.home }, async context => {
            const listed = await context.request("session/list", {
                cwd: path.join(parentAlias, path.basename(scratch.project)),
            });
            checklist.record(
                "listing finds a removed project through its surviving parent alias",
                listed.sessions.length === 1 && listed.sessions[0]?.sessionId === sessionId
                    ? null
                    : JSON.stringify(listed),
            );
        });
    } catch (error) {
        checklist.record(
            "the compiled restart exchange completes",
            error instanceof Error ? error.message : String(error),
        );
    }
}

async function recall(context: ClientContext, sessionId: string): Promise<void> {
    const response = await context.request("session/prompt", {
        sessionId,
        prompt: [
            { type: "text", text: "Recall the recovery token from before this process restarted." },
        ],
    });
    if (response.stopReason !== "end_turn")
        throw new Error(`Recall ended with ${response.stopReason}`);
}

async function inProcess(
    executable: string,
    scratch: Scratch,
    run: (context: ClientContext, updates: SessionUpdate[]) => Promise<void>,
): Promise<void> {
    const pico = Bun.spawn({
        cmd: [executable],
        cwd: scratch.project,
        env: scratch.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stderr = new Response(pico.stderr).text();
    const updates: SessionUpdate[] = [];
    const app = client({ name: "pico-restart-verify" }).onNotification(
        "session/update",
        ({ params }) => {
            updates.push(params.update);
        },
    );
    const deadline = setTimeout(() => pico.kill("SIGKILL"), 45_000);
    try {
        await app.connectWith(
            ndJsonStream(subprocessInput(pico.stdin), pico.stdout),
            async context => {
                const initialized = await context.request("initialize", {
                    protocolVersion: 1,
                    clientCapabilities: {},
                });
                const capabilities = initialized.agentCapabilities;
                if (
                    !capabilities?.loadSession ||
                    !capabilities.sessionCapabilities?.list ||
                    !capabilities.sessionCapabilities.resume
                ) {
                    throw new Error("The compiled agent did not advertise load, list and resume");
                }
                await run(context, updates);
            },
        );
        pico.stdin.end();
        const code = await pico.exited;
        if (code !== 0) throw new Error(`Pico exited ${code}: ${await stderr}`);
    } finally {
        clearTimeout(deadline);
        if (pico.exitCode === null) pico.kill();
        await pico.exited;
    }
}
