import type { AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { ChildWorktree, ChildWorktreeRecords } from "./child-worktree-records.ts";
import type { SeshQueries } from "./sesh-queries.ts";

import { branchTip, hasUncommittedChanges, repositoryOf } from "./git.ts";
import { createWorktree, findWorktrunk, removeWorktree } from "./worktrunk.ts";

export type LaunchArguments = Record<string, unknown>;

/** Sends a launch on to Sesh's own `start_session`. */
export type ForwardLaunch = (args: LaunchArguments) => Promise<AgentToolResult>;

export interface ChildLaunchContext {
    /** The parent session's working directory. */
    cwd: string;
    sesh: SeshQueries;
    records: ChildWorktreeRecords;
}

/** How much of a child's name its branch keeps. */
const BRANCH_SLUG_LIMIT = 40;

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

    const folder = await projectFolder(args.project, context.sesh);
    const repository = await repositoryOf(folder);
    if (repository === undefined) {
        return withNote(
            await forward(args),
            `No worktree: ${folder} isn't a git repository, so the child works in that folder directly.`,
        );
    }
    // In the parent's own repository, "the parent's HEAD" is the parent's checkout, not the main one.
    const checkout = repository === (await repositoryOf(context.cwd)) ? context.cwd : folder;
    const baseBranch = typeof args.baseBranch === "string" ? args.baseBranch : undefined;
    if (baseBranch === undefined && (await hasUncommittedChanges(checkout))) {
        throw new Error(
            `${checkout} has uncommitted changes, and a new worktree starts from the last commit, so the child wouldn't see them. ` +
                "Commit or discard them, then launch again.",
        );
    }

    const wt = findWorktrunk();
    const child = await createChildWorktree(
        wt,
        checkout,
        args.name,
        baseBranch ?? "@",
        onUpdate,
        signal,
    );
    const { baseBranch: _, ...rest } = args;
    let result: AgentToolResult;
    try {
        result = await forward({ ...rest, project: child.path, inPlace: true });
    } catch (error) {
        throw withLeftover(error, await discard(wt, checkout, child.branch));
    }
    if (result.isError) {
        const leftover = await discard(wt, checkout, child.branch);
        return leftover === undefined ? result : withNote(result, leftover);
    }
    context.records.add(child);
    return withNote(
        result,
        `Worktree: ${child.path}, on branch ${child.branch} from ${child.startingCommit.slice(0, 7)}.`,
    );
}

/** Creates the child's branch and worktree with Worktrunk, leaving nothing behind when that fails. */
async function createChildWorktree(
    wt: string,
    checkout: string,
    name: unknown,
    base: string,
    onUpdate: AgentToolUpdateCallback | undefined,
    signal: AbortSignal | undefined,
): Promise<ChildWorktree> {
    const branch = childBranch(name);
    try {
        const created = await createWorktree(wt, {
            checkout,
            branch,
            base,
            signal,
            onOutput: output => onUpdate?.({ content: [{ type: "text", text: output }] }),
        });
        const startingCommit = await branchTip(checkout, created.branch);
        if (startingCommit === undefined) {
            throw new Error(`Worktrunk created ${created.path} without branch ${created.branch}.`);
        }
        return { repository: checkout, path: created.path, branch: created.branch, startingCommit };
    } catch (error) {
        throw withLeftover(error, await discard(wt, checkout, branch));
    }
}

/** A launch's `project`: a folder as given, or a name Sesh's project list knows. */
async function projectFolder(project: unknown, sesh: SeshQueries): Promise<string> {
    if (typeof project !== "string" || project.length === 0) {
        throw new Error("A child launch needs a project: a folder or a Sesh project name.");
    }
    if (project === "~" || project.startsWith("~/")) return path.join(homedir(), project.slice(1));
    if (path.isAbsolute(project)) return project;
    const matches = (await sesh.projects()).filter(known => known.name === project);
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
    return matches[0]!.path;
}

/** `pico/<name as a slug>-<six hex digits>`; `child` stands in for a missing or empty name. */
function childBranch(name: unknown): string {
    const slug = (typeof name === "string" ? name : "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, BRANCH_SLUG_LIMIT)
        .replace(/-+$/, "");
    return `pico/${slug || "child"}-${randomBytes(3).toString("hex")}`;
}

/**
 * Removes a failed launch's branch and worktree, which nothing has worked in, and describes
 * what is left behind when that fails too.
 */
async function discard(wt: string, checkout: string, branch: string): Promise<string | undefined> {
    if ((await branchTip(checkout, branch)) === undefined) return undefined;
    try {
        await removeWorktree(wt, { checkout, branch, force: true });
        return undefined;
    } catch (error) {
        return `Pico couldn't remove branch ${branch} and its worktree, which this launch left behind: ${describe(error)}`;
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
