// `mise run pico:verify`: checks the compiled `pico` the way a Homebrew install runs it,
// with a scratch home, a bare PATH and no credentials. A local fake LM Studio server, which
// Oh My Pi discovers through `LM_STUDIO_BASE_URL`, supplies a scripted model, so a whole turn
// runs offline with no OMP extension or configuration file (proposal.0007).

import {
    client,
    ndJsonStream,
    type InitializeResponse,
    type PlanEntry,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FakeLmStudio } from "./fake-lm-studio.ts";

import manifest from "../../package.json" with { type: "json" };
import { verifyBackgroundJobs } from "./background-jobs.ts";
import { Checklist } from "./checklist.ts";
import { checkCommands, VERIFY_MODEL } from "./commands.ts";
import { startFakeLmStudio } from "./fake-lm-studio.ts";
import { subprocessInput } from "./processes.ts";
import { verifyRestoration } from "./restoration.ts";
import { acpMessageProblem, inspectLines } from "./wire.ts";

const REPLY = "pico verified";

const EXPECTED_CAPABILITIES = {
    loadSession: true,
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    mcpCapabilities: { http: false, sse: false },
    sessionCapabilities: { list: {}, resume: {} },
};

export interface Scratch {
    home: string;
    project: string;
    env: Record<string, string>;
    memoryToken: string;
    /** Where the offline model's background job writes its process id. */
    jobPidFile: string;
    model: FakeLmStudio;
}

function scratch(): Scratch {
    let root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-verify-")));
    let home = path.join(root, "home");
    let project = path.join(root, "project");
    const memoryToken = randomUUID();
    mkdirSync(project);
    mkdirSync(home);
    const jobPidFile = path.join(root, "background-job.pid");
    const model = startFakeLmStudio({ memoryToken, reply: REPLY, jobPidFile });
    return {
        home,
        project,
        memoryToken,
        jobPidFile,
        model,
        env: {
            HOME: home,
            USER: process.env.USER ?? "pico",
            PATH: "/usr/bin:/bin",
            LM_STUDIO_BASE_URL: model.baseUrl,
        },
    };
}

function checkVersion(executable: string, scratchDirs: Scratch, checklist: Checklist): void {
    let run = Bun.spawnSync([executable, "--version"], { env: scratchDirs.env });
    let stdout = run.stdout.toString();
    let expected = `pico ${manifest.version}\n`;
    checklist.record(
        "`pico --version` prints the package version",
        run.exitCode === 0 && stdout === expected
            ? null
            : `exit ${run.exitCode}, stdout ${JSON.stringify(stdout)}, stderr ${JSON.stringify(run.stderr.toString())}`,
    );
}

function initializeProblem(response: InitializeResponse): string | null {
    let actual = JSON.stringify({
        protocolVersion: response.protocolVersion,
        agentCapabilities: response.agentCapabilities,
        agentInfo: response.agentInfo,
    });
    let expected = JSON.stringify({
        protocolVersion: 1,
        agentCapabilities: EXPECTED_CAPABILITIES,
        agentInfo: { name: "pico", title: "Pico", version: manifest.version },
    });
    return actual === expected ? null : `got ${actual}`;
}

async function checkTurn(
    executable: string,
    scratchDirs: Scratch,
    checklist: Checklist,
): Promise<string | undefined> {
    let agent = Bun.spawn({
        cmd: [executable],
        cwd: scratchDirs.project,
        env: scratchDirs.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    // Drained from the start: unread, a chatty stderr would fill its pipe and stall the agent.
    let stderr = new Response(agent.stderr).text();
    let failure: string | null = null;
    let strayLines: string[] = [];
    let replyText = "";
    let todoCards = 0;
    let plans: PlanEntry[][] = [];
    let sessionId: string | undefined;
    let app = client({ name: "pico-verify" }).onNotification("session/update", ({ params }) => {
        let update = params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            replyText += update.content.text;
        }
        if (update.sessionUpdate === "tool_call" && update.name === "todo") todoCards++;
        if (update.sessionUpdate === "plan") plans.push(update.entries);
    });
    let stream = ndJsonStream(
        subprocessInput(agent.stdin),
        inspectLines(agent.stdout, line => {
            let problem = acpMessageProblem(line);
            if (problem !== null) strayLines.push(`${problem}: ${line.slice(0, 120)}`);
        }),
    );

    try {
        await app.connectWith(stream, async context => {
            let initialized = await context.request("initialize", {
                protocolVersion: 1,
                clientCapabilities: {},
            });
            checklist.record(
                "`initialize` claims exactly Pico's implemented capabilities",
                initializeProblem(initialized),
            );

            let session = await context.request("session/new", {
                cwd: scratchDirs.project,
                mcpServers: [],
            });
            sessionId = session.sessionId;
            let model = session.configOptions?.find(option => option.id === "model");
            checklist.record(
                "a new session starts on the saved default model",
                model?.type === "select" && model.currentValue === VERIFY_MODEL
                    ? null
                    : `model option ${JSON.stringify(model)}`,
            );

            let turn = await context.request("session/prompt", {
                sessionId: session.sessionId,
                prompt: [
                    {
                        type: "text",
                        text: `Remember ${scratchDirs.memoryToken} for the next time this conversation opens.`,
                    },
                ],
            });
            checklist.record(
                "a turn answers through the offline model",
                turn.stopReason === "end_turn" && replyText === REPLY
                    ? null
                    : `stop reason ${turn.stopReason}, reply ${JSON.stringify(replyText)}`,
            );
            let expectedPlan = [
                {
                    content: `Remember ${scratchDirs.memoryToken}`,
                    priority: "medium",
                    status: "in_progress",
                },
            ];
            checklist.record(
                "a todo call reaches the client as one plan and no tool call",
                todoCards === 0 && Bun.deepEquals(plans, [expectedPlan])
                    ? null
                    : `todo cards ${todoCards}, plans ${JSON.stringify(plans)}`,
            );
        });
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
    } finally {
        agent.kill();
        await agent.exited;
    }
    if (failure !== null) {
        checklist.record(
            "the ACP exchange completes",
            `${failure}; stderr: ${(await stderr).slice(-800)}`,
        );
    }
    checklist.record(
        "stdout carries ACP messages only",
        strayLines.length === 0 ? null : strayLines.join("; "),
    );
    return failure === null ? sessionId : undefined;
}

function checkDataDir(scratchDirs: Scratch, checklist: Checklist): void {
    let dataDir = path.join(scratchDirs.home, "Library", "Application Support", "Pico");
    let addon = path.join(dataDir, "natives");
    let versions = existsSync(addon) ? readdirSync(addon) : [];
    checklist.record(
        "the data directory is private to its owner",
        existsSync(dataDir) && (statSync(dataDir).mode & 0o777) === 0o700
            ? null
            : "missing or not 0700",
    );
    checklist.record(
        "the native addon is extracted into the data directory",
        versions.length === 1 &&
            existsSync(path.join(addon, versions[0] as string, "pi_natives.darwin-arm64.node"))
            ? null
            : `natives holds ${JSON.stringify(versions)}`,
    );
    checklist.record(
        "the model cache is in the data directory",
        existsSync(path.join(dataDir, "models.db")) ? null : "no models.db",
    );
}

/** Everything the run left under the scratch `~/.omp`, for the guide's list of remaining writes. */
function ompWrites(home: string): string[] {
    let root = path.join(home, ".omp");
    if (!existsSync(root)) return [];
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.relative(home, path.join(entry.parentPath, entry.name)))
        .toSorted();
}

async function main(): Promise<void> {
    let executable = path.resolve(
        process.argv[2] ?? path.join(import.meta.dirname, "..", "..", ".build", "pico"),
    );
    if (!existsSync(executable)) {
        process.stderr.write(`${executable} does not exist. Run \`mise run pico:build\` first.\n`);
        process.exit(1);
    }
    let scratchDirs = scratch();
    let checklist = new Checklist();
    try {
        checkVersion(executable, scratchDirs, checklist);
        await checkCommands(executable, scratchDirs, checklist);
        const sessionId = await checkTurn(executable, scratchDirs, checklist);
        if (sessionId) await verifyRestoration(executable, scratchDirs, sessionId, checklist);
        await verifyBackgroundJobs(executable, scratchDirs, checklist);
        checkDataDir(scratchDirs, checklist);
        process.stdout.write(`${checklist.report()}\n`);
        process.stdout.write(
            `Written under ~/.omp:\n${
                ompWrites(scratchDirs.home)
                    .map(file => `  ~/${file}`)
                    .join("\n") || "  nothing"
            }\n`,
        );
    } finally {
        scratchDirs.model.stop();
        rmSync(path.dirname(scratchDirs.home), { recursive: true, force: true });
    }
    if (!checklist.passed) {
        process.stderr.write("pico:verify found failing checks.\n");
        process.exit(1);
    }
}

if (import.meta.main) await main();
