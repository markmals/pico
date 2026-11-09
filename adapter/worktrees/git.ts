import { stripGitRepoLocationEnv } from "@oh-my-pi/pi-utils/env";
import path from "node:path";

/**
 * Pico's environment as it is now, for git and Worktrunk, without the repository location a git
 * hook exports (`GIT_DIR`, `GIT_WORK_TREE`, …): inherited, it would point them at that hook's
 * repository instead of the folder Pico names. Bun otherwise passes the environment it started with.
 */
export function folderGitEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    stripGitRepoLocationEnv(env);
    return env;
}

interface GitRun {
    exitCode: number;
    stdout: string;
    stderr: string;
}

async function git(cwd: string, args: readonly string[]): Promise<GitRun> {
    try {
        const run = Bun.spawn(["git", ...args], {
            cwd,
            env: folderGitEnv(),
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(run.stdout).text(),
            new Response(run.stderr).text(),
            run.exited,
        ]);
        return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
        // A folder that does not exist cannot be a working directory at all.
        return { exitCode: -1, stdout: "", stderr: String(error) };
    }
}

/** The repository's shared git directory, which every one of its worktrees reports; undefined outside git. */
export async function repositoryOf(folder: string): Promise<string | undefined> {
    const run = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return run.exitCode === 0 ? path.resolve(run.stdout) : undefined;
}

/** Staged or unstaged changes, or untracked files that are not ignored. */
export async function hasUncommittedChanges(checkout: string): Promise<boolean> {
    const run = await git(checkout, ["status", "--porcelain", "--untracked-files=normal"]);
    if (run.exitCode !== 0) {
        throw new Error(`git could not read the status of ${checkout}: ${run.stderr}`);
    }
    return run.stdout.length > 0;
}

/** The commit a local branch points at, or undefined when the branch does not exist. */
export async function branchTip(checkout: string, branch: string): Promise<string | undefined> {
    const run = await git(checkout, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return run.exitCode === 0 ? run.stdout : undefined;
}

/** The commit a revision names, or undefined when it names none. */
export async function commitOf(checkout: string, revision: string): Promise<string | undefined> {
    const run = await git(checkout, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
    return run.exitCode === 0 ? run.stdout : undefined;
}

/** The branch a worktree has checked out, or undefined on a detached HEAD. */
export async function checkedOutBranch(worktree: string): Promise<string | undefined> {
    const run = await git(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return run.exitCode === 0 ? run.stdout : undefined;
}

/** Where the repository has a branch checked out, or undefined when no worktree has it. */
export async function worktreeWithBranch(
    checkout: string,
    branch: string,
): Promise<string | undefined> {
    const run = await git(checkout, ["worktree", "list", "--porcelain"]);
    if (run.exitCode !== 0) return undefined;
    const entry = run.stdout
        .split("\n\n")
        .map(block => block.split("\n"))
        .find(lines => lines.includes(`branch refs/heads/${branch}`));
    return entry?.find(line => line.startsWith("worktree "))?.slice("worktree ".length);
}

/**
 * Deletes a branch only while it still points at `expectedTip`, so a commit made meanwhile is
 * never lost; false when the branch has moved.
 */
export async function deleteBranchAt(
    checkout: string,
    branch: string,
    expectedTip: string,
): Promise<boolean> {
    const run = await git(checkout, ["update-ref", "-d", `refs/heads/${branch}`, expectedTip]);
    return run.exitCode === 0;
}
