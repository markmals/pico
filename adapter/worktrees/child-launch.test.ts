import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LaunchArguments } from "./child-launch.ts";

import { launchChild } from "./child-launch.ts";
import { ChildWorktreeRecords } from "./child-worktree-records.ts";

// Without the repository location a git hook exports: see child-worktrees.test.ts.
const fixtureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const roots: string[] = [];
afterAll(() => {
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

describe("proposal.0010 a launch's branch is always its own", () => {
    test("a name already taken by a branch with work on it is skipped, and that branch untouched", async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-child-launch-")));
        roots.push(root);
        const checkout = join(root, "repo");
        git(root, "init", "-q", "-b", "main", checkout);
        git(checkout, "commit", "-q", "--allow-empty", "-m", "init");
        git(checkout, "branch", "pico/review-aaaaaa");
        git(checkout, "worktree", "add", "-q", join(root, "taken"), "pico/review-aaaaaa");
        git(join(root, "taken"), "commit", "-q", "--allow-empty", "-m", "someone's work");
        const taken = git(checkout, "rev-parse", "pico/review-aaaaaa");
        const suffixes = ["aaaaaa", "bbbbbb"];
        const forwarded: LaunchArguments[] = [];

        await launchChild(
            { project: checkout, prompt: "review", name: "review" },
            async args => {
                forwarded.push(args);
                return { content: [{ type: "text", text: "started" }] };
            },
            {
                cwd: checkout,
                sesh: { projects: async () => [], children: async () => [] },
                records: new ChildWorktreeRecords(SessionManager.inMemory(checkout)),
                branchSuffix: () => suffixes.shift() ?? "cccccc",
            },
        );

        expect(git(checkout, "rev-parse", "pico/review-aaaaaa")).toBe(taken);
        expect(forwarded[0]?.project).toBe(join(root, ".worktrees", "repo.pico-review-bbbbbb"));
    }, 60_000);
});
