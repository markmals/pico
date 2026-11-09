import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { ChildWorktree, ChildWorktreeRecords } from "./child-worktree-records.ts";
import type { SeshQueries } from "./sesh-queries.ts";

import {
    branchTip,
    checkedOutBranch,
    commitOf,
    deleteBranchAt,
    hasUncommittedChanges,
    repositoryOf,
    worktreeWithBranch,
} from "./git.ts";
import { createWorktree, findWorktrunk, removeWorktree } from "./worktrunk.ts";

export type LaunchArguments = Record<string, unknown>;

/** Sends a launch on to Sesh's own `start_session`. */
export type ForwardLaunch = (args: LaunchArguments) => Promise<AgentToolResult>;

export interface ChildLaunchContext {
    /** The parent session's working directory. */
    cwd: string;
    sesh: SeshQueries;
    records: ChildWorktreeRecords;
    /** The six hex digits that end a child's branch name; random unless a test pins them. */
    branchSuffix?: () => string;
}

/** How much of a child's name its branch keeps. */
const BRANCH_SLUG_LIMIT = 40;

/** How many branch names a launch tries before giving up on finding one nobody has. */
const BRANCH_ATTEMPTS = 5;

/**
 * Starts a Sesh child in a new Worktrunk worktree branched from the parent's last commit, or
 * fails without starting one. An in-place launch, or one outside git, goes to Sesh unchanged
 * (proposal.0010).
 */
export async function launchChild(
    args: LaunchArguments,
    forward: ForwardLaunch,
    context: ChildLaunchContext,
    onUpdate?: AgentToolUpdateCallback,
    signal?: AbortSignal,
): Promise<AgentToolResult> {
    if (args.inPlace === true) return forward(args);

    const { folder, named } = await projectFolder(args.project, context);
    const repository = await repositoryOf(folder);
    if (repository === undefined) {
        return withNote(
            await forward(named ? args : { ...args, project: folder }),
            `No worktree: ${folder} isn't a git repository, so the child works in that folder directly.`,
        );
    }
    // In the parent's own repository, "the parent's HEAD" is the parent's checkout, not the main one.
    const checkout = repository === (await repositoryOf(context.cwd)) ? context.cwd : folder;
    const start = await startingPoint(checkout, args.baseBranch);

    const wt = findWorktrunk();
    const branch = await unusedBranch(checkout, args.name, context.branchSuffix ?? randomSuffix);
    const child = await createChildWorktree(wt, checkout, branch, start, onUpdate, signal);
    const { baseBranch: _, ...rest } = args;
    let result: AgentToolResult;
    try {
        result = await forward({ ...rest, project: child.path, inPlace: true });
    } catch (error) {
        throw withLeftover(error, await discard(wt, checkout, child.branch, child.startingCommit));
    }
    if (result.isError) {
        const leftover = await discard(wt, checkout, child.branch, child.startingCommit);
        return leftover === undefined ? result : withNote(result, leftover);
    }
    context.records.add(child);
    return withNote(
        result,
        `Worktree: ${child.path}, on branch ${child.branch} from ${child.startingCommit.slice(0, 7)}.`,
    );
}

/** Where a child's branch starts: what Worktrunk is given as its base, and the commit that names. */
interface StartingPoint {
    base: string;
    /** Unknown for a `baseBranch` only Worktrunk can resolve, such as one that exists only on a remote. */
    commit?: string;
}

/**
 * The checkout's HEAD, which must have nothing uncommitted, or the launch's `baseBranch`. On a
 * branch the base is `@`, so the project's hooks get Worktrunk's `{{ base }}` and
 * `{{ base_worktree_path }}`; a detached HEAD has no branch for `@` to name, so it is the commit.
 */
async function startingPoint(checkout: string, baseBranch: unknown): Promise<StartingPoint> {
    if (typeof baseBranch === "string") {
        return { base: baseBranch, commit: await commitOf(checkout, baseBranch) };
    }
    if (await hasUncommittedChanges(checkout)) {
        throw new Error(
            `${checkout} has uncommitted changes, and a new worktree starts from the last commit, so the child wouldn't see them. ` +
                "Commit or discard them, then launch again.",
        );
    }
    const head = await commitOf(checkout, "HEAD");
    if (head === undefined) {
        throw new Error(`${checkout} has no commit yet for a child to start from.`);
    }
    return { base: (await checkedOutBranch(checkout)) === undefined ? head : "@", commit: head };
}

/** Creates the child's branch and worktree with Worktrunk, leaving nothing behind when that fails. */
async function createChildWorktree(
    wt: string,
    checkout: string,
    branch: string,
    start: StartingPoint,
    onUpdate: AgentToolUpdateCallback | undefined,
    signal: AbortSignal | undefined,
): Promise<ChildWorktree> {
    try {
        const created = await createWorktree(wt, {
            checkout,
            branch,
            base: start.base,
            signal,
            onOutput: output => onUpdate?.({ content: [{ type: "text", text: output }] }),
        });
        const startingCommit = await branchTip(checkout, created.branch);
        if (startingCommit === undefined) {
            throw new Error(`Worktrunk created ${created.path} without branch ${created.branch}.`);
        }
        return { repository: checkout, path: created.path, branch: created.branch, startingCommit };
    } catch (error) {
        throw withLeftover(error, await discard(wt, checkout, branch, start.commit));
    }
}

/**
 * A launch's `project`: an absolute or `~` folder as given, a relative path against the parent's
 * folder, or otherwise a name Sesh's project list knows. `named` says which.
 */
async function projectFolder(
    project: unknown,
    context: ChildLaunchContext,
): Promise<{ folder: string; named: boolean }> {
    if (typeof project !== "string" || project.length === 0) {
        throw new Error("A child launch needs a project: a folder or a Sesh project name.");
    }
    if (project === "~" || project.startsWith("~/")) {
        return { folder: path.join(homedir(), project.slice(1)), named: false };
    }
    if (path.isAbsolute(project)) return { folder: project, named: false };
    if (project === "." || project === ".." || project.includes(path.sep)) {
        return { folder: path.resolve(context.cwd, project), named: false };
    }
    const matches = (await context.sesh.projects()).filter(known => known.name === project);
    if (matches.length === 0) {
        throw new Error(
            `Sesh has no project named "${project}". Name a known project or give its folder.`,
        );
    }
    if (matches.length > 1) {
        throw new Error(
            `Sesh has ${matches.length} projects named "${project}" (${matches.map(match => match.path).join(", ")}). Give the project's folder instead.`,
        );
    }
    return { folder: matches[0]!.path, named: true };
}

/** A child branch name no branch in the repository has yet, so a failed launch removes only its own. */
async function unusedBranch(
    checkout: string,
    name: unknown,
    suffix: () => string,
): Promise<string> {
    for (let attempt = 0; attempt < BRANCH_ATTEMPTS; attempt++) {
        const branch = childBranch(name, suffix());
        if ((await branchTip(checkout, branch)) === undefined) return branch;
    }
    throw new Error(
        `Pico couldn't find an unused branch name for this child in ${BRANCH_ATTEMPTS} tries.`,
    );
}

/** `pico/<name as a slug>-<suffix>`; `child` stands in for a missing or empty name. */
function childBranch(name: unknown, suffix: string): string {
    const slug = (typeof name === "string" ? name : "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, BRANCH_SLUG_LIMIT)
        .replace(/-+$/, "");
    return `pico/${slug || "child"}-${suffix}`;
}

function randomSuffix(): string {
    return randomBytes(3).toString("hex");
}

/**
 * Removes the branch a failed launch created, and its worktree, which nothing has worked in.
 * A branch that no longer points at the launch's starting commit is kept. Describes whatever
 * is left behind.
 */
async function discard(
    wt: string,
    checkout: string,
    branch: string,
    base: string | undefined,
): Promise<string | undefined> {
    const tip = await branchTip(checkout, branch);
    if (tip === undefined) return undefined;
    const worktree = await worktreeWithBranch(checkout, branch);
    const leftover = `${worktree === undefined ? "" : `the worktree ${worktree} and `}branch ${branch}`;
    if (base !== undefined && tip !== base) {
        return `Pico kept ${leftover}, which this launch created, because the branch has moved from ${base.slice(0, 7)}.`;
    }
    try {
        if (worktree !== undefined) await removeWorktree(wt, { checkout, worktree, force: true });
        await deleteBranchAt(checkout, branch, tip);
        return undefined;
    } catch (error) {
        return `Pico couldn't remove ${leftover}, which this launch left behind: ${describe(error)}`;
    }
}

function withLeftover(error: unknown, leftover: string | undefined): unknown {
    return leftover === undefined ? error : new Error(`${describe(error)}\n${leftover}`);
}

function withNote(result: AgentToolResult, note: string): AgentToolResult {
    return { ...result, content: [...result.content, { type: "text", text: note }] };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
