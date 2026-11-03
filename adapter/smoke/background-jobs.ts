import { client, ndJsonStream } from "@agentclientprotocol/sdk";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Checklist } from "./checklist.ts";
import type { Scratch } from "./verify.ts";

import { BACKGROUND_JOB_PROMPT } from "./fake-lm-studio.ts";
import { subprocessInput } from "./processes.ts";

/** How long the offline model has to start its background job. */
const JOB_START_MS = 20_000;

/**
 * Disconnects from the compiled `pico` while a background job that ignores SIGTERM is running,
 * and checks that the job's process is gone once `pico` has exited (proposal.0008).
 */
export async function verifyBackgroundJobs(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    // The restoration checks move the shared project away, so this check brings its own.
    const project = path.join(path.dirname(scratch.home), "background-jobs-project");
    mkdirSync(project, { recursive: true });
    const pico = Bun.spawn({
        cmd: [executable],
        cwd: project,
        env: scratch.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stderr = new Response(pico.stderr).text();
    const deadline = setTimeout(() => pico.kill("SIGKILL"), 45_000);
    let jobPid: number | undefined;
    try {
        await client({ name: "pico-background-verify" }).connectWith(
            ndJsonStream(subprocessInput(pico.stdin), pico.stdout),
            async context => {
                await context.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
                const session = await context.request("session/new", {
                    cwd: project,
                    mcpServers: [],
                });
                // The turn holds while its job runs, so the client disconnects without its answer.
                void context
                    .request("session/prompt", {
                        sessionId: session.sessionId,
                        prompt: [{ type: "text", text: BACKGROUND_JOB_PROMPT }],
                    })
                    .catch(() => undefined);
                jobPid = await publishedPid(scratch.jobPidFile);
            },
        );
        pico.stdin.end();
        const code = await pico.exited;
        checklist.record(
            "disconnecting during a background job ends pico cleanly",
            code === 0 ? null : `pico exited ${code}: ${(await stderr).slice(-800)}`,
        );
        checklist.record(
            "no process a background job started outlives pico",
            isRunning(jobPid) ? `process ${jobPid} is still running` : null,
        );
    } catch (error) {
        checklist.record(
            "a background job starts and pico disconnects",
            `${error instanceof Error ? error.message : String(error)}; stderr: ${(await stderr).slice(-800)}`,
        );
    } finally {
        clearTimeout(deadline);
        if (pico.exitCode === null) pico.kill();
        await pico.exited;
        if (jobPid !== undefined && isRunning(jobPid)) process.kill(jobPid, "SIGKILL");
    }
}

/** The job's own process id, which it writes once it runs; nothing announces that moment. */
async function publishedPid(file: string): Promise<number> {
    const deadline = Date.now() + JOB_START_MS;
    while (!existsSync(file) || readFileSync(file, "utf8").trim() === "") {
        if (Date.now() >= deadline) throw new Error(`the background job never wrote ${file}`);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 25);
        await promise;
    }
    return Number(readFileSync(file, "utf8").trim());
}

function isRunning(pid: number | undefined): boolean {
    if (pid === undefined) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
