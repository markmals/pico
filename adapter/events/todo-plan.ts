import type { PlanEntry, SessionUpdate } from "@agentclientprotocol/sdk";
import type { TodoItem, TodoPhase } from "@oh-my-pi/pi-coding-agent/tools";

/**
 * The engine's todo list as ACP plan entries: one flat list in the engine's
 * order, with no phase names. ACP has no status for an abandoned or a blocked
 * item, so an abandoned item leaves the plan and a blocked one stays pending
 * with its blocker named. ACP requires a priority the list does not have.
 */
export function planEntries(phases: readonly TodoPhase[]): PlanEntry[] {
    return phases.flatMap(phase =>
        phase.tasks.flatMap((task): PlanEntry[] => {
            if (task.status === "abandoned") return [];
            const status = task.status === "blocked" ? "pending" : task.status;
            return [{ content: entryContent(task), priority: "medium", status }];
        }),
    );
}

function entryContent(task: TodoItem): string {
    if (task.status !== "blocked") return task.content;
    return task.blocker
        ? `${task.content} (blocked: ${task.blocker})`
        : `${task.content} (blocked)`;
}

/**
 * The plan one attachment has sent its client. ACP clients replace their plan
 * wholesale, so every report carries the complete list; a list whose plan is
 * unchanged is not reported again.
 */
export class PlanReporter {
    /** A new session's client has no plan, which reads the same as an empty one. */
    #sent = "[]";

    /** The plan, when it differs from the one the client last received. */
    changes(phases: readonly TodoPhase[]): SessionUpdate[] {
        const entries = planEntries(phases);
        if (JSON.stringify(entries) === this.#sent) return [];
        return [this.#report(entries)];
    }

    /** The plan, whatever the client last received: a reopened client's copy may be stale. */
    current(phases: readonly TodoPhase[]): SessionUpdate {
        return this.#report(planEntries(phases));
    }

    #report(entries: PlanEntry[]): SessionUpdate {
        this.#sent = JSON.stringify(entries);
        return { sessionUpdate: "plan", entries };
    }
}
