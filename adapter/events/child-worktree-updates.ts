import type { SessionUpdate } from "@agentclientprotocol/sdk";

import { randomUUID } from "node:crypto";

import type { ChildWorktreeCleanup } from "../worktrees/child-worktree-cleanup.ts";

/** The tool name Pico's own worktree removals carry; no engine tool has it. */
const CLEANUP_TOOL = "pico_child_worktree_cleanup";

/**
 * Each removal Pico attempted, and a check it could not make, as a tool call of its own with
 * its outcome (proposal.0010).
 */
export function childWorktreeUpdates(cleanup: ChildWorktreeCleanup): SessionUpdate[] {
    const updates = cleanup.removals.flatMap(({ worktree, error, keptBranch }) =>
        toolCall(
            `Remove unchanged worktree ${worktree.branch}`,
            "delete",
            { path: worktree.path, branch: worktree.branch },
            error ??
                (keptBranch
                    ? `Removed ${worktree.path}, but kept branch ${worktree.branch}: it gained a commit while the worktree was being removed.`
                    : `Removed ${worktree.path} and branch ${worktree.branch}: the child's turn had ended and it changed nothing.`),
            error === undefined,
            [{ path: worktree.path }],
        ),
    );
    if (cleanup.failure !== undefined) {
        updates.push(...toolCall("Check child worktrees", "other", {}, cleanup.failure, false));
    }
    return updates;
}

function toolCall(
    title: string,
    kind: "delete" | "other",
    rawInput: Record<string, string>,
    text: string,
    succeeded: boolean,
    locations?: { path: string }[],
): SessionUpdate[] {
    const toolCallId = `pico-worktree-${randomUUID()}`;
    return [
        {
            sessionUpdate: "tool_call",
            toolCallId,
            name: CLEANUP_TOOL,
            title,
            kind,
            status: "in_progress",
            rawInput,
            ...(locations ? { locations } : {}),
        },
        {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: succeeded ? "completed" : "failed",
            content: [{ type: "content", content: { type: "text", text } }],
        },
    ];
}
