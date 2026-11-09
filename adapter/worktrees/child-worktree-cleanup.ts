import { existsSync } from "node:fs";
import path from "node:path";

import type { ChildWorktree, ChildWorktreeRecords } from "./child-worktree-records.ts";
import type { SeshChild, SeshQueries } from "./sesh-queries.ts";

import { branchTip, hasUncommittedChanges } from "./git.ts";
import { findWorktrunk, removeWorktree } from "./worktrunk.ts";

/** One removal Pico attempted: it succeeded unless it carries an error. */
export interface ChildWorktreeRemoval {
    worktree: ChildWorktree;
    error?: string;
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
            records.drop(worktree);
            continue;
        }
        const child = children.find(
            listed => path.resolve(listed.cwd) === path.resolve(worktree.path),
        );
        if (child !== undefined && !finishedTurn(child)) continue;
        try {
            if (!(await unchanged(worktree))) {
                records.drop(worktree);
                continue;
            }
            await removeWorktree(findWorktrunk(), {
                checkout: worktree.repository,
                branch: worktree.branch,
                force: false,
            });
            records.drop(worktree);
            removals.push({ worktree });
        } catch (error) {
            removals.push({ worktree, error: describe(error) });
        }
    }
    return { removals };
}

/**
 * Sesh reports a child it has just started as idle before its first turn, so an idle child has
 * finished only once it has replied.
 */
function finishedTurn(child: SeshChild): boolean {
    if (child.state === "idle") return Boolean(child.lastReply);
    return child.state === "stopped" || child.state === "error";
}

async function unchanged(worktree: ChildWorktree): Promise<boolean> {
    if (await hasUncommittedChanges(worktree.path)) return false;
    return (await branchTip(worktree.path, worktree.branch)) === worktree.startingCommit;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
