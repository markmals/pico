import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import type { ChildWorktree, ChildWorktreeRecords } from "./child-worktree-records.ts";
import type { SeshChild, SeshQueries } from "./sesh-queries.ts";

import { branchTip, checkedOutBranch, deleteBranchAt, hasUncommittedChanges } from "./git.ts";
import { findWorktrunk, removeWorktree } from "./worktrunk.ts";

/** One removal Pico attempted: it removed the worktree unless it carries an error. */
export interface ChildWorktreeRemoval {
    worktree: ChildWorktree;
    error?: string;
    /** Set when the branch gained a commit while its worktree was being removed, so it stays. */
    keptBranch?: boolean;
}

export interface ChildWorktreeCleanup {
    removals: ChildWorktreeRemoval[];
    /** Why nothing could be checked, when Sesh's session list was unavailable. */
    failure?: string;
}

/**
 * Removes the worktrees of children whose turn has ended and that changed nothing; a worktree
 * with work in it is left for the user and no longer checked (proposal.0010).
 */
export async function cleanUpChildWorktrees(
    records: ChildWorktreeRecords,
    sesh: SeshQueries | undefined,
): Promise<ChildWorktreeCleanup> {
    const open = records.open;
    if (open.length === 0) return { removals: [] };
    let children: SeshChild[];
    try {
        if (sesh === undefined) throw new Error("This session has no Sesh connection.");
        children = await sesh.children();
    } catch (error) {
        return {
            removals: [],
            failure: `Pico couldn't check its children's worktrees, so it removed none: ${describe(error)}`,
        };
    }

    const removals: ChildWorktreeRemoval[] = [];
    for (const worktree of open) {
        if (!existsSync(worktree.path)) {
            const removal = await deleteBranch(records, worktree, false);
            if (removal !== undefined) removals.push(removal);
            continue;
        }
        const folder = canonical(worktree.path);
        const sessions = children.filter(
            child => child.cwd !== undefined && canonical(child.cwd) === folder,
        );
        if (sessions.some(child => !finishedTurn(child))) continue;
        const removal = await removeIfUnchanged(records, worktree);
        if (removal !== undefined) removals.push(removal);
    }
    return { removals };
}

/** Removes a finished child's worktree when it changed nothing; undefined when it keeps its work. */
async function removeIfUnchanged(
    records: ChildWorktreeRecords,
    worktree: ChildWorktree,
): Promise<ChildWorktreeRemoval | undefined> {
    try {
        if (!(await unchanged(worktree))) {
            records.drop(worktree);
            return undefined;
        }
        await removeWorktree(findWorktrunk(), {
            checkout: worktree.repository,
            worktree: worktree.path,
            force: false,
        });
    } catch (error) {
        return { worktree, error: describe(error) };
    }
    return deleteBranch(records, worktree, true);
}

/**
 * Deletes the branch of a worktree that is gone while it still points at its starting commit.
 * A branch that has moved, or is already gone, keeps whatever it holds. A deletion git refuses
 * for another reason, such as a lock, is a failure, and the next check tries again.
 */
async function deleteBranch(
    records: ChildWorktreeRecords,
    worktree: ChildWorktree,
    removedNow: boolean,
): Promise<ChildWorktreeRemoval | undefined> {
    try {
        await deleteBranchAt(worktree.repository, worktree.branch, worktree.startingCommit);
        records.drop(worktree);
        return { worktree };
    } catch (error) {
        const tip = await branchTip(worktree.repository, worktree.branch);
        if (tip === worktree.startingCommit) {
            return {
                worktree,
                error: `The worktree ${worktree.path} is gone, but Pico couldn't delete branch ${worktree.branch}: ${describe(error)}`,
            };
        }
        records.drop(worktree);
        // A commit made while the removal hooks ran moved the branch; it keeps that work.
        return removedNow && tip !== undefined ? { worktree, keptBranch: true } : undefined;
    }
}

/**
 * Sesh reports a child it has just started as idle before its first turn, so an idle child has
 * finished only once it has replied. A state Pico doesn't know counts as still working.
 */
function finishedTurn(child: SeshChild): boolean {
    if (child.state === "idle") return Boolean(child.lastReply);
    return child.state === "stopped" || child.state === "error";
}

/** Still on its own branch, at the commit it started from, with nothing uncommitted. */
async function unchanged(worktree: ChildWorktree): Promise<boolean> {
    if ((await checkedOutBranch(worktree.path)) !== worktree.branch) return false;
    if (await hasUncommittedChanges(worktree.path)) return false;
    return (await branchTip(worktree.path, worktree.branch)) === worktree.startingCommit;
}

/** One spelling per folder, so a path Sesh reports through a symlink still matches. */
function canonical(folder: string): string {
    try {
        return realpathSync(folder);
    } catch {
        return path.resolve(folder);
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
