import type { McpServerStdio, SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { MockResponseSource } from "@oh-my-pi/pi-ai/providers/mock";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { ConnectedClient } from "./agent-harness.ts";

import { fakeMcpServer } from "../engine/testing/mcp-fixture.ts";
import { connectPicoAgent } from "./agent-harness.ts";
import {
    mockEngine,
    removeTemporaryDirectories,
    temporaryDataDir,
    temporaryProject,
} from "./engine-harness.ts";
import { picoAgentShutdown } from "./pico-agent.ts";
import { closeOpenConnections, startPicoSession, waitUntil } from "./session-fixture.ts";

const LAUNCH_SCHEMA = {
    type: "object",
    properties: {
        project: { type: "string" },
        prompt: { type: "string" },
        name: { type: "string" },
        baseBranch: { type: "string" },
        inPlace: { type: "boolean" },
        reportBack: { type: "boolean" },
        agent: { type: "string" },
    },
    required: ["project", "prompt"],
    additionalProperties: false,
};

const roots: string[] = [];

// hk runs this suite from `pre-push`, and git exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE
// to its hooks. A fixture's git inheriting them would act on the outer repository, and Bun's
// default for a child is the environment the test process started with, so it gets this one.
const fixtureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

afterEach(closeOpenConnections);
afterAll(() => {
    removeTemporaryDirectories();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
    const run = Bun.spawnSync(
        ["git", "-c", "user.name=Pico Test", "-c", "user.email=pico@example.com", ...args],
        { cwd, env: fixtureEnv, stdout: "pipe", stderr: "pipe" },
    );
    if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
    return run.stdout.toString().trim();
}

interface Repository {
    /** Holds the repository and, beside it, the `.worktrees` folder Pico's children land in. */
    root: string;
    /** The main checkout, on `feature`, one commit ahead of `main`. */
    checkout: string;
    mainCommit: string;
    featureCommit: string;
}

/**
 * A repository whose `pre-start` hook reports progress and writes an ignored `.prepared`
 * marker, as setup would.
 */
function repository(preStart = "echo preparing >&2; echo ready > .prepared"): Repository {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-child-worktrees-")));
    roots.push(root);
    const checkout = join(root, "repo");
    mkdirSync(join(checkout, ".config"), { recursive: true });
    git(checkout, "init", "-q", "-b", "main");
    writeFileSync(join(checkout, ".gitignore"), ".prepared\n");
    writeFileSync(join(checkout, ".config", "wt.toml"), `[[pre-start]]\nsetup = "${preStart}"\n`);
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "init");
    const mainCommit = git(checkout, "rev-parse", "HEAD");
    git(checkout, "switch", "-q", "-c", "feature");
    writeFileSync(join(checkout, "feature.txt"), "feature\n");
    git(checkout, "add", "feature.txt");
    git(checkout, "commit", "-q", "-m", "feature work");
    return { root, checkout, mainCommit, featureCommit: git(checkout, "rev-parse", "HEAD") };
}

interface Sesh {
    server: McpServerStdio;
    /** Sets what Sesh reports for every child the parent started. */
    children(status: Record<string, unknown>): void;
    launches(): Array<Record<string, unknown>>;
}

function sesh(projects: unknown[] = [], options: { failLaunch?: boolean } = {}): Sesh {
    const dir = temporaryProject();
    const calls = join(dir, "sesh-calls.jsonl");
    const projectsFile = join(dir, "projects.json");
    const childrenFile = join(dir, "children.json");
    writeFileSync(projectsFile, JSON.stringify({ projects }));
    writeFileSync(childrenFile, JSON.stringify({ state: "working" }));
    const server = fakeMcpServer("sesh", {
        flags: [
            "--tool",
            "start_session",
            "--tool",
            "list_projects",
            "--tool",
            "list_sessions",
            "--input-schema",
            JSON.stringify(LAUNCH_SCHEMA),
            "--calls-file",
            calls,
            "--answer",
            `list_projects=${projectsFile}`,
            "--sesh-children",
            childrenFile,
            ...(options.failLaunch ? ["--fail-tool", "start_session"] : []),
        ],
    });
    return {
        server,
        children: status => writeFileSync(childrenFile, JSON.stringify(status)),
        launches: () =>
            existsSync(calls)
                ? readFileSync(calls, "utf8")
                      .trim()
                      .split("\n")
                      .map(
                          line =>
                              JSON.parse(line) as {
                                  name: string;
                                  arguments: Record<string, unknown>;
                              },
                      )
                      .filter(call => call.name === "start_session")
                      .map(call => call.arguments)
                : [],
    };
}

function launch(args: Record<string, unknown>, id = "launch") {
    return {
        content: [
            { type: "toolCall" as const, id, name: "mcp__sesh_start_session", arguments: args },
        ],
    };
}

function endedCall(updates: SessionUpdate[], id: string): ToolCallUpdate | undefined {
    return updates.findLast(
        (update): update is ToolCallUpdate & { sessionUpdate: "tool_call_update" } =>
            update.sessionUpdate === "tool_call_update" &&
            update.toolCallId === id &&
            (update.status === "completed" || update.status === "failed"),
    );
}

function textOf(update: ToolCallUpdate | undefined): string {
    return (update?.content ?? [])
        .map(item =>
            item.type === "content" && item.content.type === "text" ? item.content.text : "",
        )
        .join("\n");
}

function picoBranches(checkout: string): string[] {
    return git(checkout, "branch", "--list", "pico/*", "--format=%(refname:short)")
        .split("\n")
        .filter(Boolean);
}

function childWorktrees(root: string): string[] {
    const folder = join(root, ".worktrees");
    return existsSync(folder) ? readdirSync(folder) : [];
}

/** The tool calls Pico reported for its own worktree removals, ended. */
function removals(updates: SessionUpdate[]): ToolCallUpdate[] {
    const started = new Set(
        updates.flatMap(update =>
            update.sessionUpdate === "tool_call" && update.title.startsWith("Remove ")
                ? [update.toolCallId]
                : [],
        ),
    );
    return updates.filter(
        (update): update is ToolCallUpdate & { sessionUpdate: "tool_call_update" } =>
            update.sessionUpdate === "tool_call_update" &&
            started.has(update.toolCallId) &&
            (update.status === "completed" || update.status === "failed"),
    );
}

describe("proposal.0010 launching a child in a new worktree", () => {
    test("the child starts in ../.worktrees on a new branch from the parent's last commit, set up", async () => {
        const repo = repository();
        const host = sesh();
        const session = await startPicoSession(
            [
                launch({ project: repo.checkout, prompt: "review", name: "Review auth!" }),
                { content: ["done"] },
            ],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate a review");

        const [branch] = picoBranches(repo.checkout);
        expect(branch).toMatch(/^pico\/review-auth-[0-9a-f]{6}$/);
        const worktree = join(repo.root, ".worktrees", `repo.${branch!.replace("/", "-")}`);
        expect(host.launches()).toEqual([
            { project: worktree, prompt: "review", name: "Review auth!", inPlace: true },
        ]);
        expect(git(worktree, "rev-parse", "HEAD")).toBe(repo.featureCommit);
        expect(git(worktree, "branch", "--show-current")).toBe(branch!);
        expect(existsSync(join(worktree, ".prepared"))).toBe(true);
        const ended = endedCall(session.updates(), "launch");
        expect(ended?.status).toBe("completed");
        expect(textOf(ended)).toContain(worktree);
        expect(textOf(ended)).toContain(branch!);
        const reported = session
            .updates()
            .filter(
                (update): update is ToolCallUpdate & { sessionUpdate: "tool_call_update" } =>
                    update.sessionUpdate === "tool_call_update" && update.toolCallId === "launch",
            );
        expect(reported.some(update => textOf(update).includes("preparing"))).toBe(true);
    }, 60_000);

    test("an explicit in-place launch goes to Sesh unchanged", async () => {
        const repo = repository();
        const host = sesh();
        const session = await startPicoSession(
            [
                launch({ project: repo.checkout, prompt: "here", inPlace: true }),
                { content: ["done"] },
            ],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("work in place");

        expect(host.launches()).toEqual([
            { project: repo.checkout, prompt: "here", inPlace: true },
        ]);
        expect(picoBranches(repo.checkout)).toEqual([]);
        expect(childWorktrees(repo.root)).toEqual([]);
    }, 60_000);

    test("a folder outside git goes to Sesh unchanged, and the result says it has no worktree", async () => {
        const folder = temporaryProject();
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: folder, prompt: "tidy" }), { content: ["done"] }],
            { cwd: folder, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(host.launches()).toEqual([{ project: folder, prompt: "tidy" }]);
        const ended = endedCall(session.updates(), "launch");
        expect(ended?.status).toBe("completed");
        expect(textOf(ended)).toMatch(/no worktree/i);
        expect(textOf(ended)).toMatch(/not a git repository|isn't a git repository/i);
    }, 60_000);

    for (const [kind, change] of [
        [
            "a modified file",
            (checkout: string) => writeFileSync(join(checkout, "feature.txt"), "edited\n"),
        ],
        [
            "an untracked file",
            (checkout: string) => writeFileSync(join(checkout, "notes.txt"), "draft\n"),
        ],
        [
            "a staged file",
            (checkout: string) => {
                writeFileSync(join(checkout, "staged.txt"), "staged\n");
                git(checkout, "add", "staged.txt");
            },
        ],
    ] as const) {
        test(`a checkout with ${kind} refuses the launch and starts nothing`, async () => {
            const repo = repository();
            change(repo.checkout);
            const host = sesh();
            const session = await startPicoSession(
                [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
                { cwd: repo.checkout, mcpServers: [host.server] },
            );

            await session.prompt("delegate");

            const ended = endedCall(session.updates(), "launch");
            expect(ended?.status).toBe("failed");
            expect(textOf(ended)).toContain(repo.checkout);
            expect(textOf(ended)).toMatch(/uncommitted/i);
            expect(textOf(ended)).toMatch(/commit/i);
            expect(host.launches()).toEqual([]);
            expect(picoBranches(repo.checkout)).toEqual([]);
            expect(childWorktrees(repo.root)).toEqual([]);
        }, 60_000);
    }

    test("an ignored file does not count as an uncommitted change", async () => {
        const repo = repository();
        writeFileSync(join(repo.checkout, ".prepared"), "ignored\n");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        const [launched] = host.launches();
        expect(launched?.project).toStartWith(join(repo.root, ".worktrees"));
    }, 60_000);

    test("an explicit baseBranch starts the worktree there, whatever the checkout holds", async () => {
        const repo = repository();
        writeFileSync(join(repo.checkout, "notes.txt"), "draft\n");
        const host = sesh();
        const session = await startPicoSession(
            [
                launch({ project: repo.checkout, prompt: "fix", baseBranch: "main" }),
                { content: ["done"] },
            ],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate from main");

        const [branch] = picoBranches(repo.checkout);
        expect(branch).toMatch(/^pico\/child-[0-9a-f]{6}$/);
        const [launched] = host.launches();
        expect(launched).toEqual({ project: expect.any(String), prompt: "fix", inPlace: true });
        expect(git(launched!.project as string, "rev-parse", "HEAD")).toBe(repo.mainCommit);
    }, 60_000);

    test("a project folder in the parent's repository starts from the parent's own checkout", async () => {
        const repo = repository();
        git(repo.checkout, "switch", "-q", "main");
        const parent = join(repo.root, "parent");
        git(repo.checkout, "worktree", "add", "-q", parent, "feature");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: parent, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        const [launched] = host.launches();
        expect(git(launched!.project as string, "rev-parse", "HEAD")).toBe(repo.featureCommit);
    }, 60_000);

    test("a project named in Sesh's list resolves to its folder; an unknown name fails", async () => {
        const repo = repository();
        const host = sesh([{ name: "repo", path: repo.checkout, isGitRepo: true }]);
        const session = await startPicoSession(
            [
                launch({ project: "repo", prompt: "review" }, "named"),
                launch({ project: "nowhere", prompt: "review" }, "unknown"),
                { content: ["done"] },
            ],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate by name");

        expect(endedCall(session.updates(), "named")?.status).toBe("completed");
        const unknown = endedCall(session.updates(), "unknown");
        expect(unknown?.status).toBe("failed");
        expect(textOf(unknown)).toContain("nowhere");
        const launched = host.launches();
        expect(launched).toHaveLength(1);
        expect(git(launched[0]!.project as string, "rev-parse", "HEAD")).toBe(repo.featureCommit);
    }, 60_000);
});

describe("proposal.0010 a launch acts on the repository it names", () => {
    test("a git location inherited from a git hook does not redirect the launch", async () => {
        const repo = repository();
        const decoy = repository();
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );
        process.env.GIT_DIR = join(decoy.checkout, ".git");
        process.env.GIT_WORK_TREE = decoy.checkout;
        try {
            await session.prompt("delegate");
        } finally {
            delete process.env.GIT_DIR;
            delete process.env.GIT_WORK_TREE;
        }

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        expect(picoBranches(repo.checkout)).toHaveLength(1);
        expect(picoBranches(decoy.checkout)).toEqual([]);
        expect(childWorktrees(repo.root)).toHaveLength(1);
    }, 60_000);
});

describe("proposal.0010 a launch fails closed", () => {
    test("a failing pre-start hook fails the launch with its error and leaves nothing behind", async () => {
        const repo = repository("echo setup broke >&2; exit 7");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        const ended = endedCall(session.updates(), "launch");
        expect(ended?.status).toBe("failed");
        expect(textOf(ended)).toContain("setup broke");
        expect(textOf(ended)).toMatch(/\b7\b/);
        expect(host.launches()).toEqual([]);
        expect(picoBranches(repo.checkout)).toEqual([]);
        expect(childWorktrees(repo.root)).toEqual([]);
    }, 60_000);

    test("a launch Sesh refuses removes the worktree Pico made for it", async () => {
        const repo = repository();
        const host = sesh([], { failLaunch: true });
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        const ended = endedCall(session.updates(), "launch");
        expect(ended?.status).toBe("failed");
        expect(textOf(ended)).toContain("fake start_session failed");
        const [refused] = host.launches();
        expect(refused?.project).toStartWith(join(repo.root, ".worktrees"));
        expect(existsSync(refused!.project as string)).toBe(false);
        expect(picoBranches(repo.checkout)).toEqual([]);
        expect(childWorktrees(repo.root)).toEqual([]);
    }, 60_000);

    test.skipIf(existsSync("/opt/homebrew/bin/wt"))(
        "without Worktrunk the launch fails and says how to install it",
        async () => {
            const repo = repository();
            const host = sesh();
            const session = await startPicoSession(
                [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
                { cwd: repo.checkout, mcpServers: [host.server] },
            );
            const path = process.env.PATH;
            process.env.PATH = "/usr/bin:/bin";
            try {
                await session.prompt("delegate");
            } finally {
                process.env.PATH = path;
            }

            const ended = endedCall(session.updates(), "launch");
            expect(ended?.status).toBe("failed");
            expect(textOf(ended)).toContain("brew install worktrunk");
            expect(host.launches()).toEqual([]);
        },
        60_000,
    );

    test("cancelling while setup runs stops it and leaves nothing behind", async () => {
        const repo = repository("sleep 30");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        const running = session.prompt("delegate");
        expect(await waitUntil(() => picoBranches(repo.checkout).length === 1, 20_000)).toBe(true);
        await session.client.agent.notify("session/cancel", { sessionId: session.sessionId });

        expect((await running).stopReason).toBe("cancelled");
        expect(host.launches()).toEqual([]);
        expect(picoBranches(repo.checkout)).toEqual([]);
        expect(childWorktrees(repo.root)).toEqual([]);
    }, 60_000);
});

describe("proposal.0010 cleanup when a child's turn ends", () => {
    async function launchedChild(repo: Repository, host: Sesh, turns: number) {
        const responses = [
            launch({ project: repo.checkout, prompt: "review" }),
            ...Array.from({ length: turns }, () => ({ content: ["ok"] })),
        ];
        const session = await startPicoSession(responses, {
            cwd: repo.checkout,
            mcpServers: [host.server],
        });
        await session.prompt("delegate");
        const [launched] = host.launches();
        return { session, worktree: launched!.project as string };
    }

    test("a working child keeps its worktree; once its turn has ended an unchanged one is removed", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 2);
        expect(existsSync(worktree)).toBe(true);
        expect(removals(session.updates())).toEqual([]);

        host.children({ state: "idle", lastReply: "Reviewed; nothing to change." });
        await session.prompt("the child reported back");

        expect(existsSync(worktree)).toBe(false);
        expect(picoBranches(repo.checkout)).toEqual([]);
        const removed = removals(session.updates());
        expect(removed.map(update => update.status)).toEqual(["completed"]);
    }, 60_000);

    for (const status of [
        { state: "stopped" },
        { state: "error", lastReply: "failed" },
        { listed: false },
    ]) {
        test(`a child that is ${JSON.stringify(status)} has finished its turn`, async () => {
            const repo = repository();
            const host = sesh();
            const { session, worktree } = await launchedChild(repo, host, 2);

            host.children(status);
            await session.prompt("next turn");

            expect(existsSync(worktree)).toBe(false);
            expect(picoBranches(repo.checkout)).toEqual([]);
        }, 60_000);
    }

    for (const status of [{ state: "idle" }, { state: "needsInput", lastReply: "Which file?" }]) {
        test(`a child that is ${JSON.stringify(status)} has not finished, so it keeps its worktree`, async () => {
            const repo = repository();
            const host = sesh();
            const { session, worktree } = await launchedChild(repo, host, 2);

            host.children(status);
            await session.prompt("next turn");

            expect(worktree).toStartWith(join(repo.root, ".worktrees"));
            expect(existsSync(worktree)).toBe(true);
            expect(removals(session.updates())).toEqual([]);
        }, 60_000);
    }

    for (const [kind, change] of [
        [
            "a commit",
            (worktree: string) => {
                writeFileSync(join(worktree, "fix.txt"), "fix\n");
                git(worktree, "add", "fix.txt");
                git(worktree, "commit", "-q", "-m", "fix");
            },
        ],
        [
            "an uncommitted file",
            (worktree: string) => writeFileSync(join(worktree, "draft.txt"), "draft\n"),
        ],
    ] as const) {
        test(`a finished child with ${kind} keeps its worktree and branch for good`, async () => {
            const repo = repository();
            const host = sesh();
            const { session, worktree } = await launchedChild(repo, host, 3);
            change(worktree);

            host.children({ state: "idle", lastReply: "Done." });
            await session.prompt("next turn");
            if (existsSync(join(worktree, "draft.txt"))) rmSync(join(worktree, "draft.txt"));
            await session.prompt("and another");

            expect(existsSync(worktree)).toBe(true);
            expect(picoBranches(repo.checkout)).toHaveLength(1);
            expect(removals(session.updates())).toEqual([]);
        }, 60_000);
    }

    test("a removal that fails is reported and tried again at the next turn", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 3);
        const config = join(repo.checkout, ".config", "wt.toml");
        const original = readFileSync(config, "utf8");
        writeFileSync(config, `${original}\n[[pre-remove]]\nguard = "echo not yet >&2; exit 9"\n`);

        host.children({ state: "idle", lastReply: "Done." });
        await session.prompt("next turn");

        const [failed] = removals(session.updates());
        expect(failed?.status).toBe("failed");
        expect(textOf(failed)).toContain("not yet");
        expect(existsSync(worktree)).toBe(true);

        writeFileSync(config, original);
        await session.prompt("and another");

        // The turn that failed checked at its start and again at its end.
        expect(removals(session.updates()).map(update => update.status)).toEqual([
            "failed",
            "failed",
            "completed",
        ]);
        expect(existsSync(worktree)).toBe(false);
    }, 60_000);

    test("closing the parent session removes an unchanged finished child's worktree", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 1);

        host.children({ state: "idle", lastReply: "Done." });
        await session.client.close();
        await picoAgentShutdown(session.client.app).completed;

        expect(existsSync(worktree)).toBe(false);
        expect(picoBranches(repo.checkout)).toEqual([]);
    }, 60_000);

    test("the checks continue after Pico restarts and Sesh reopens the parent", async () => {
        const repo = repository();
        const host = sesh();
        const dataDir = temporaryDataDir();
        const connect = async (responses: MockResponseSource) => {
            const engine = await mockEngine(responses);
            const client = connectPicoAgent({
                version: "0.0.0-test",
                dataDir,
                createSession: engine.createSession,
            });
            await client.initialize();
            return client;
        };
        const shutDown = async (client: ConnectedClient) => {
            await client.close();
            await picoAgentShutdown(client.app).completed;
        };
        const promptOn = (client: ConnectedClient, sessionId: string, text: string) =>
            client.agent.request("session/prompt", {
                sessionId,
                prompt: [{ type: "text", text }],
            });

        const before = await connect([
            launch({ project: repo.checkout, prompt: "review" }),
            { content: ["done"] },
        ]);
        const { sessionId } = (await before.agent.request("session/new", {
            cwd: repo.checkout,
            mcpServers: [host.server],
        })) as { sessionId: string };
        await promptOn(before, sessionId, "delegate");
        await shutDown(before);
        const [launched] = host.launches();
        const worktree = launched!.project as string;
        expect(existsSync(worktree)).toBe(true);

        host.children({ state: "idle", lastReply: "Done." });
        const after = await connect([{ content: ["ok"] }]);
        try {
            await after.agent.request("session/resume", {
                sessionId,
                cwd: repo.checkout,
                mcpServers: [host.server],
            });
            await promptOn(after, sessionId, "continue");

            expect(existsSync(worktree)).toBe(false);
            expect(picoBranches(repo.checkout)).toEqual([]);
        } finally {
            await shutDown(after);
        }
    }, 60_000);

    for (const [kind, change] of [
        [
            "switched to another branch and committed",
            (worktree: string) => {
                git(worktree, "switch", "-q", "-c", "fix");
                git(worktree, "commit", "-q", "--allow-empty", "-m", "fix");
            },
        ],
        [
            "committed on a detached HEAD",
            (worktree: string) => {
                git(worktree, "switch", "-q", "--detach");
                git(worktree, "commit", "-q", "--allow-empty", "-m", "detached work");
            },
        ],
    ] as const) {
        test(`a finished child that ${kind} keeps its worktree`, async () => {
            const repo = repository();
            const host = sesh();
            const { session, worktree } = await launchedChild(repo, host, 2);
            change(worktree);

            host.children({ state: "idle", lastReply: "Done." });
            await session.prompt("next turn");

            expect(existsSync(worktree)).toBe(true);
            expect(removals(session.updates())).toEqual([]);
        }, 60_000);
    }

    test("a commit made while removal hooks run keeps the child's branch", async () => {
        const repo = repository();
        const host = sesh();
        const { session } = await launchedChild(repo, host, 2);
        const [branch] = picoBranches(repo.checkout);
        const config = join(repo.checkout, ".config", "wt.toml");
        writeFileSync(
            config,
            `${readFileSync(config, "utf8")}\n[[pre-remove]]\nlate = "git -C {{ worktree_path }} -c user.name=Late -c user.email=late@example.com commit -q --allow-empty -m late"\n`,
        );

        host.children({ state: "idle", lastReply: "Done." });
        await session.prompt("next turn");

        expect(git(repo.checkout, "log", "-1", "--format=%s", branch!)).toBe("late");
        const [removal] = removals(session.updates());
        expect(textOf(removal)).toContain(branch!);
    }, 60_000);

    test("Sesh naming the child's folder by another path still finds the child", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 2);
        const links = join(repo.root, "links");
        symlinkSync(join(repo.root, ".worktrees"), links);

        host.children({
            sessions: [{ id: "child", cwd: join(links, basename(worktree)), state: "working" }],
        });
        await session.prompt("next turn");

        expect(existsSync(worktree)).toBe(true);
        expect(removals(session.updates())).toEqual([]);
    }, 60_000);

    test("any session still working in the worktree keeps it, whatever another reports", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 2);

        host.children({
            sessions: [
                { id: "earlier", cwd: worktree, state: "stopped" },
                { id: "later", cwd: worktree, state: "working" },
            ],
        });
        await session.prompt("next turn");

        expect(existsSync(worktree)).toBe(true);
    }, 60_000);

    test("a listed session without a folder does not stop the check", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 2);

        host.children({
            sessions: [
                { id: "elsewhere", state: "working" },
                { id: "child", cwd: worktree, state: "idle", lastReply: "Done." },
            ],
        });
        await session.prompt("next turn");

        expect(existsSync(worktree)).toBe(false);
        expect(removals(session.updates()).map(update => update.status)).toEqual(["completed"]);
    }, 60_000);

    test("a Worktrunk setting that keeps branches does not stop Pico removing its own", async () => {
        const repo = repository();
        const host = sesh();
        const config = join(repo.root, "xdg-config");
        mkdirSync(join(config, "worktrunk"), { recursive: true });
        writeFileSync(
            join(config, "worktrunk", "config.toml"),
            "[remove]\ndelete-branch = false\n",
        );
        const previous = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = config;
        try {
            const { session, worktree } = await launchedChild(repo, host, 2);
            host.children({ state: "idle", lastReply: "Done." });
            await session.prompt("next turn");

            expect(existsSync(worktree)).toBe(false);
            expect(picoBranches(repo.checkout)).toEqual([]);
        } finally {
            if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
            else process.env.XDG_CONFIG_HOME = previous;
        }
    }, 60_000);

    test("a branch Pico couldn't delete is reported as a failure and deleted at the next turn", async () => {
        const repo = repository();
        const host = sesh();
        const { session, worktree } = await launchedChild(repo, host, 3);
        const [branch] = picoBranches(repo.checkout);
        const lock = join(repo.checkout, ".git", "refs", "heads", `${branch!}.lock`);
        writeFileSync(lock, "");

        host.children({ state: "idle", lastReply: "Done." });
        await session.prompt("next turn");

        expect(existsSync(worktree)).toBe(false);
        expect(picoBranches(repo.checkout)).toEqual([branch!]);
        const [failed] = removals(session.updates());
        expect(failed?.status).toBe("failed");
        expect(textOf(failed)).toContain(branch!);

        rmSync(lock);
        await session.prompt("and another");

        expect(picoBranches(repo.checkout)).toEqual([]);
        expect(removals(session.updates()).at(-1)?.status).toBe("completed");
    }, 60_000);
});

describe("proposal.0010 launches from unusual checkouts", () => {
    test("a parent on a detached HEAD launches from that commit", async () => {
        const repo = repository();
        git(repo.checkout, "switch", "-q", "--detach");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        const [launched] = host.launches();
        expect(git(launched!.project as string, "rev-parse", "HEAD")).toBe(repo.featureCommit);
    }, 60_000);

    test("a relative folder is the parent's folder, resolved", async () => {
        const repo = repository();
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: ".", prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        const [launched] = host.launches();
        expect(launched?.project).toStartWith(join(repo.root, ".worktrees"));
    }, 60_000);

    test("a launch that cannot clean up after itself names the worktree and branch it left", async () => {
        const repo = repository();
        const config = join(repo.checkout, ".config", "wt.toml");
        writeFileSync(
            config,
            `${readFileSync(config, "utf8")}\n[[pre-remove]]\nblock = "exit 5"\n`,
        );
        git(repo.checkout, "commit", "-q", "-am", "block removals");
        const host = sesh([], { failLaunch: true });
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        const ended = endedCall(session.updates(), "launch");
        expect(ended?.status).toBe("failed");
        const [branch] = picoBranches(repo.checkout);
        const [refused] = host.launches();
        expect(textOf(ended)).toContain(branch!);
        expect(textOf(ended)).toContain(refused!.project as string);
    }, 60_000);

    test("the project's hooks see the parent's branch and checkout as Worktrunk's base", async () => {
        const repo = repository("echo {{ base }} {{ base_worktree_path }} > .prepared");
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: repo.checkout, prompt: "review" }), { content: ["done"] }],
            { cwd: repo.checkout, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        const [launched] = host.launches();
        expect(readFileSync(join(launched!.project as string, ".prepared"), "utf8").trim()).toBe(
            `feature ${repo.checkout}`,
        );
    }, 60_000);

    test("a baseBranch that exists only on the remote starts the child from it", async () => {
        const origin = repository();
        git(origin.checkout, "switch", "-q", "main");
        const clone = join(origin.root, "clone");
        git(origin.root, "clone", "-q", origin.checkout, clone);
        const host = sesh();
        const session = await startPicoSession(
            [
                launch({ project: clone, prompt: "fix", baseBranch: "feature" }),
                { content: ["done"] },
            ],
            { cwd: clone, mcpServers: [host.server] },
        );

        await session.prompt("delegate from the remote branch");

        expect(endedCall(session.updates(), "launch")?.status).toBe("completed");
        const [launched] = host.launches();
        expect(git(launched!.project as string, "rev-parse", "HEAD")).toBe(origin.featureCommit);
    }, 60_000);

    test("a relative folder outside git reaches Sesh resolved against the parent's folder", async () => {
        const parent = temporaryProject();
        mkdirSync(join(parent, "notes"));
        const host = sesh();
        const session = await startPicoSession(
            [launch({ project: "./notes", prompt: "tidy" }), { content: ["done"] }],
            { cwd: parent, mcpServers: [host.server] },
        );

        await session.prompt("delegate");

        expect(host.launches()).toEqual([{ project: join(parent, "notes"), prompt: "tidy" }]);
    }, 60_000);
});
