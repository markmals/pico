import { client, ndJsonStream } from "@agentclientprotocol/sdk";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

import type { Checklist } from "./checklist.ts";
import type { Scratch } from "./verify.ts";

import { GIT_WORKTREE_PROMPT } from "./fake-lm-studio.ts";
import { subprocessInput } from "./processes.ts";

/**
 * Has the compiled `pico` run `git worktree add` through `bash` in a scratch repository, and
 * checks that git made the worktree: OMP's worktree cloning would turn the command into
 * `pico worktree add`, which `pico` rejects (proposal.0010).
 */
export async function verifyGitWorktreeAdd(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const root = path.dirname(scratch.home);
    const project = path.join(root, "git-worktree-project");
    const worktree = path.join(root, "git-worktree-checkout");
    mkdirSync(project, { recursive: true });
    const setup = initializeRepository(project, scratch.env);
    if (setup !== null) {
        checklist.record("a scratch git repository is created", setup);
        return;
    }

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
    const statuses = new Map<string, string>();
    const app = client({ name: "pico-git-worktree-verify" }).onNotification(
        "session/update",
        ({ params }) => {
            const update = params.update;
            if (
                (update.sessionUpdate === "tool_call" ||
                    update.sessionUpdate === "tool_call_update") &&
                update.status
            ) {
                statuses.set(update.toolCallId, update.status);
            }
        },
    );
    try {
        const turn = await app.connectWith(
            ndJsonStream(subprocessInput(pico.stdin), pico.stdout),
            async context => {
                await context.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
                const session = await context.request("session/new", {
                    cwd: project,
                    mcpServers: [],
                });
                return context.request("session/prompt", {
                    sessionId: session.sessionId,
                    prompt: [{ type: "text", text: `${GIT_WORKTREE_PROMPT}${worktree}` }],
                });
            },
        );
        const linked = existsSync(path.join(worktree, ".git"))
            ? statSync(path.join(worktree, ".git")).isFile()
            : false;
        checklist.record(
            "`git worktree add` through bash makes a git worktree",
            turn.stopReason === "end_turn" &&
                Bun.deepEquals([...statuses.values()], ["completed"]) &&
                linked
                ? null
                : `stop reason ${turn.stopReason}, tool statuses ${JSON.stringify([...statuses.values()])}, linked worktree ${linked}`,
        );
    } catch (error) {
        checklist.record(
            "a git worktree turn completes",
            `${error instanceof Error ? error.message : String(error)}; stderr: ${(await stderr).slice(-800)}`,
        );
    } finally {
        clearTimeout(deadline);
        pico.kill();
        await pico.exited;
    }
}

/** A repository with one commit, so `git worktree add` has a HEAD to check out. */
function initializeRepository(project: string, env: Record<string, string>): string | null {
    for (const args of [
        ["init", "-q", "-b", "main"],
        [
            "-c",
            "user.name=Pico",
            "-c",
            "user.email=pico@example.com",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "init",
        ],
    ]) {
        const run = Bun.spawnSync(["git", ...args], { cwd: project, env });
        if (run.exitCode !== 0) return `git ${args.join(" ")}: ${run.stderr.toString()}`;
    }
    return null;
}
