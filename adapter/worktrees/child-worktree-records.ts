import type { SessionManager } from "@oh-my-pi/pi-coding-agent";

import { z } from "@oh-my-pi/pi-coding-agent";

const CUSTOM_TYPE = "pico.child-worktree";

const worktree = z.object({
    /** The checkout Worktrunk ran from, and runs from again to remove it. */
    repository: z.string(),
    path: z.string(),
    branch: z.string(),
    /** The branch's tip when it was made; a later tip means the child committed. */
    startingCommit: z.string(),
});

const record = z.union([
    z.object({ version: z.literal(1), change: z.literal("added"), worktree }),
    z.object({ version: z.literal(1), change: z.literal("dropped"), path: z.string() }),
]);

export type ChildWorktree = z.infer<typeof worktree>;

/**
 * The worktrees Pico made for this parent's children and still checks, journaled with the
 * parent's own history so a reopened parent keeps checking them (proposal.0010).
 */
export class ChildWorktreeRecords {
    readonly #manager: SessionManager;
    readonly #open = new Map<string, ChildWorktree>();

    constructor(manager: SessionManager) {
        this.#manager = manager;
        for (const entry of manager.getBranch()) {
            if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
            const parsed = record.safeParse(entry.data);
            if (!parsed.success) {
                throw new Error(
                    `Invalid or unsupported Pico child worktree record in entry ${entry.id}: ${parsed.error.message}`,
                );
            }
            if (parsed.data.change === "added") {
                this.#open.set(parsed.data.worktree.path, parsed.data.worktree);
            } else {
                this.#open.delete(parsed.data.path);
            }
        }
    }

    get open(): ChildWorktree[] {
        return [...this.#open.values()];
    }

    add(child: ChildWorktree): void {
        this.#manager.appendCustomEntry(CUSTOM_TYPE, {
            version: 1,
            change: "added",
            worktree: child,
        });
        this.#open.set(child.path, child);
    }

    drop(child: ChildWorktree): void {
        this.#manager.appendCustomEntry(CUSTOM_TYPE, {
            version: 1,
            change: "dropped",
            path: child.path,
        });
        this.#open.delete(child.path);
    }
}
