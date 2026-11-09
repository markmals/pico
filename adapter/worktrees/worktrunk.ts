import { existsSync } from "node:fs";

/** Where Homebrew links `wt` on Apple silicon, for a `pico` launched without it on its PATH. */
const HOMEBREW_WORKTRUNK = "/opt/homebrew/bin/wt";

/**
 * Child worktrees sit in a hidden `.worktrees` folder beside the main checkout. The location
 * is a user setting a project cannot carry, so Pico passes it on every run (proposal.0010).
 */
const WORKTREE_PATH = "{{ repo_path }}/../.worktrees/{{ repo }}.{{ branch | sanitize }}";

/** How long a stopped `wt` and its hooks get after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 2_000;

export class WorktrunkMissingError extends Error {
    constructor() {
        super(
            `Pico couldn't find Worktrunk (\`wt\`) on its PATH or at ${HOMEBREW_WORKTRUNK}, so it can't create the child's worktree. ` +
                "Install it with `brew install worktrunk`, then launch again.",
        );
    }
}

export class WorktrunkError extends Error {}

export function findWorktrunk(): string {
    // The PATH Pico has now; Bun.which otherwise reads the one it started with.
    const found =
        Bun.which("wt", { PATH: process.env.PATH ?? "" }) ??
        (existsSync(HOMEBREW_WORKTRUNK) ? HOMEBREW_WORKTRUNK : null);
    if (found === null) throw new WorktrunkMissingError();
    return found;
}

export interface CreatedWorktree {
    path: string;
    branch: string;
}

export interface CreateWorktree {
    /** The checkout whose HEAD `@` means; Worktrunk runs from here. */
    checkout: string;
    branch: string;
    /** `@` for the checkout's HEAD, or a branch to start from. */
    base: string;
    /** Worktrunk's progress and hook output so far, as it arrives. */
    onOutput?: (output: string) => void;
    signal?: AbortSignal;
}

/**
 * Creates the branch and its worktree, running the project's blocking `pre-start` hooks. Hook
 * commands are approved for this run only (`--yes`): the child cannot answer a prompt.
 */
export async function createWorktree(
    wt: string,
    request: CreateWorktree,
): Promise<CreatedWorktree> {
    const run = await runWorktrunk(
        wt,
        [
            "-C",
            request.checkout,
            "switch",
            "--create",
            request.branch,
            `--base=${request.base}`,
            "--no-cd",
            "--yes",
            "--format=json",
            "--config-set",
            `worktree-path="${WORKTREE_PATH}"`,
        ],
        request.onOutput,
        request.signal,
    );
    if (run.exitCode !== 0) {
        throw new WorktrunkError(
            `Worktrunk couldn't create the child's worktree (exit ${run.exitCode}):\n${run.output}`,
        );
    }
    const result = lastJsonLine(run.stdout);
    if (typeof result?.path !== "string" || typeof result.branch !== "string") {
        throw new WorktrunkError(
            `Worktrunk reported success but not the worktree it created. Its output was:\n${run.stdout}\n${run.output}`,
        );
    }
    return { path: result.path, branch: result.branch };
}

/**
 * Removes a branch's worktree and the branch, waiting for the project's `pre-remove` hooks.
 * `force` also discards uncommitted files, for a worktree nothing has worked in yet.
 */
export async function removeWorktree(
    wt: string,
    request: { checkout: string; branch: string; force: boolean },
): Promise<void> {
    const run = await runWorktrunk(wt, [
        "-C",
        request.checkout,
        "remove",
        request.branch,
        "--foreground",
        "--force-delete",
        "--yes",
        ...(request.force ? ["--force"] : []),
    ]);
    if (run.exitCode !== 0) {
        throw new WorktrunkError(
            `Worktrunk couldn't remove branch ${request.branch} and its worktree (exit ${run.exitCode}):\n${run.output}`,
        );
    }
}

interface WorktrunkRun {
    exitCode: number;
    stdout: string;
    /** What Worktrunk and its hooks wrote to stderr: its progress and its errors. */
    output: string;
}

async function runWorktrunk(
    wt: string,
    args: readonly string[],
    onOutput?: (output: string) => void,
    signal?: AbortSignal,
): Promise<WorktrunkRun> {
    signal?.throwIfAborted();
    // Its own process group, so stopping it also stops the hooks it is running.
    const run = Bun.spawn([wt, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
    });
    const stop = () => stopGroup(run.pid);
    signal?.addEventListener("abort", stop, { once: true });
    try {
        const stdout = new Response(run.stdout).text();
        let output = "";
        const decoder = new TextDecoder();
        for await (const chunk of run.stderr) {
            output += decoder.decode(chunk, { stream: true });
            onOutput?.(output);
        }
        const exitCode = await run.exited;
        signal?.throwIfAborted();
        return { exitCode, stdout: await stdout, output: output.trim() };
    } finally {
        signal?.removeEventListener("abort", stop);
    }
}

function stopGroup(pid: number): void {
    const signalGroup = (signal: NodeJS.Signals) => {
        try {
            process.kill(-pid, signal);
        } catch {
            // The group has already exited.
        }
    };
    signalGroup("SIGTERM");
    setTimeout(() => signalGroup("SIGKILL"), STOP_GRACE_MS).unref();
}

function lastJsonLine(stdout: string): Record<string, unknown> | undefined {
    const line = stdout
        .split("\n")
        .map(text => text.trim())
        .findLast(text => text.startsWith("{"));
    if (line === undefined) return undefined;
    try {
        return JSON.parse(line) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}
