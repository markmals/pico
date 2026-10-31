// `mise run pico:verify`: checks the compiled `pico` the way a Homebrew install runs it,
// with a scratch home, a bare PATH and no credentials. A project extension that imports
// an Oh My Pi package supplies a scripted model, so a whole turn runs offline.

import { client, ndJsonStream, type InitializeResponse } from "@agentclientprotocol/sdk";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../../package.json" with { type: "json" };
import { Checklist } from "./checklist.ts";
import { subprocessInput } from "./processes.ts";
import { acpMessageProblem, inspectLines } from "./wire.ts";

const REPLY = "pico verified";

// Loaded by `pico` at runtime from the project, as a user's extension would be. Its imports
// resolve only through the module map compiled into `pico`: a named subpath export of
// `@oh-my-pi/pi-ai`, and a subpath of `@oh-my-pi/pi-utils` served by its `./*` catch-all.
const PROVIDER_EXTENSION = `import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";

if (typeof getAgentDir !== "function") throw new Error("@oh-my-pi/pi-utils/dirs did not load");

const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const echo = createMockModel({ id: "echo", provider: "pico-verify", handler: { content: [${JSON.stringify(REPLY)}] } });

export default function (pi) {
    pi.registerProvider("pico-verify", {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "verify",
        api: "pico-verify",
        streamSimple: (model, context, options) => echo.stream(model, context, options),
        models: [{ id: "echo", name: "Echo", reasoning: false, input: ["text"], cost, contextWindow: 200000, maxTokens: 32000 }],
    });
}
`;

/** What proposal 0001 says `initialize` claims, and nothing more. */
const EXPECTED_CAPABILITIES = {
    loadSession: false,
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    mcpCapabilities: { http: false, sse: false },
};

interface Scratch {
    home: string;
    project: string;
    env: Record<string, string>;
}

function scratch(): Scratch {
    let root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-verify-")));
    let home = path.join(root, "home");
    let project = path.join(root, "project");
    mkdirSync(path.join(project, ".omp", "extensions"), { recursive: true });
    mkdirSync(home);
    writeFileSync(
        path.join(project, ".omp", "extensions", "verify-provider.ts"),
        PROVIDER_EXTENSION,
    );
    writeFileSync(
        path.join(project, ".omp", "config.yml"),
        "modelRoles:\n  default: pico-verify/echo\n",
    );
    return {
        home,
        project,
        env: { HOME: home, USER: process.env.USER ?? "pico", PATH: "/usr/bin:/bin" },
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
): Promise<void> {
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
    let app = client({ name: "pico-verify" }).onNotification("session/update", ({ params }) => {
        let update = params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            replyText += update.content.text;
        }
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
                "`initialize` claims exactly proposal 0001's capabilities",
                initializeProblem(initialized),
            );

            let session = await context.request("session/new", {
                cwd: scratchDirs.project,
                mcpServers: [],
            });
            let model = session.configOptions?.find(option => option.id === "model");
            checklist.record(
                "a session starts on the extension's model",
                model?.type === "select" && model.currentValue === "pico-verify/echo"
                    ? null
                    : `model option ${JSON.stringify(model)}`,
            );

            let turn = await context.request("session/prompt", {
                sessionId: session.sessionId,
                prompt: [{ type: "text", text: "hello" }],
            });
            checklist.record(
                "a turn answers through the extension that imports Oh My Pi",
                turn.stopReason === "end_turn" && replyText === REPLY
                    ? null
                    : `stop reason ${turn.stopReason}, reply ${JSON.stringify(replyText)}`,
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
        await checkTurn(executable, scratchDirs, checklist);
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
        rmSync(path.dirname(scratchDirs.home), { recursive: true, force: true });
    }
    if (!checklist.passed) {
        process.stderr.write("pico:verify found failing checks.\n");
        process.exit(1);
    }
}

if (import.meta.main) await main();
