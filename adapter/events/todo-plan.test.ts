import type { TodoItem, TodoPhase, TodoStatus } from "@oh-my-pi/pi-coding-agent/tools";

import { describe, expect, test } from "bun:test";

import { planEntries, PlanReporter } from "./todo-plan.ts";

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed", "abandoned", "blocked"];

function item(content: string, status: TodoStatus, blocker?: string): TodoItem {
    return blocker === undefined ? { content, status } : { content, status, blocker };
}

/** A 32-bit xorshift, deterministic per seed. */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state % bound;
    };
}

function randomPhases(seed: number): TodoPhase[] {
    const next = randomSource(seed);
    return Array.from({ length: next(4) }, (_phase, phaseIndex) => ({
        name: `Phase ${seed}-${phaseIndex}`,
        tasks: Array.from({ length: next(5) }, (_task, taskIndex) => {
            const status = STATUSES[next(STATUSES.length)]!;
            const blocker = status === "blocked" && next(2) === 0 ? `note ${taskIndex}` : undefined;
            return item(`task ${seed}-${phaseIndex}-${taskIndex}`, status, blocker);
        }),
    }));
}

describe("proposal.0006 flattening the todo list into a plan", () => {
    test("each status maps to its plan status, and abandoned items leave the plan", () => {
        const phases: TodoPhase[] = [
            {
                name: "Build",
                tasks: [
                    item("Write the test", "completed"),
                    item("Write the code", "in_progress"),
                    item("Try the other approach", "abandoned"),
                ],
            },
            {
                name: "Ship",
                tasks: [
                    item("Open the pull request", "pending"),
                    item("Ask for review", "blocked", "needs a reviewer"),
                    item("Merge", "blocked"),
                ],
            },
        ];

        expect(planEntries(phases)).toEqual([
            { content: "Write the test", priority: "medium", status: "completed" },
            { content: "Write the code", priority: "medium", status: "in_progress" },
            { content: "Open the pull request", priority: "medium", status: "pending" },
            {
                content: "Ask for review (blocked: needs a reviewer)",
                priority: "medium",
                status: "pending",
            },
            { content: "Merge (blocked)", priority: "medium", status: "pending" },
        ]);
    });

    test("an empty list, and a list of only abandoned items, is a plan with no entries", () => {
        expect(planEntries([])).toEqual([]);
        expect(planEntries([{ name: "Tasks", tasks: [] }])).toEqual([]);
        expect(planEntries([{ name: "Tasks", tasks: [item("Dropped", "abandoned")] }])).toEqual([]);
    });

    test("for any list, the plan carries every item that is not abandoned once, in order, without phase names", () => {
        let abandoned = 0;
        let blocked = 0;
        let entries = 0;
        for (let seed = 1; seed <= 300; seed++) {
            const phases = randomPhases(seed);
            const kept = phases.flatMap(phase =>
                phase.tasks.filter(task => task.status !== "abandoned"),
            );
            const plan = planEntries(phases);
            abandoned += phases.flatMap(phase => phase.tasks).length - kept.length;
            blocked += kept.filter(task => task.status === "blocked").length;
            entries += plan.length;

            expect(plan.length, `seed ${seed}`).toBe(kept.length);
            for (const [index, entry] of plan.entries()) {
                const task = kept[index]!;
                expect(entry.priority, `seed ${seed}`).toBe("medium");
                expect(entry.content.startsWith(task.content), `seed ${seed}`).toBe(true);
                expect(entry.status as string, `seed ${seed}`).toBe(
                    task.status === "blocked" ? "pending" : task.status,
                );
                for (const phase of phases) {
                    expect(entry.content.includes(phase.name), `seed ${seed}`).toBe(false);
                }
            }
        }
        expect(abandoned, "generated abandoned items").toBeGreaterThan(0);
        expect(blocked, "generated blocked items").toBeGreaterThan(0);
        expect(entries, "generated plan entries").toBeGreaterThan(0);
    });
});

describe("proposal.0006 reporting the plan to the client", () => {
    const list: TodoPhase[] = [{ name: "Tasks", tasks: [item("First", "pending")] }];

    test("a new session's first non-empty list is reported, and an unchanged list is not reported again", () => {
        const reporter = new PlanReporter();

        expect(reporter.changes([])).toEqual([]);
        expect(reporter.changes(list)).toEqual([
            {
                sessionUpdate: "plan",
                entries: [{ content: "First", priority: "medium", status: "pending" }],
            },
        ]);
        expect(reporter.changes(list)).toEqual([]);
    });

    test("a change that only moves items between phases is not reported", () => {
        const reporter = new PlanReporter();
        expect(reporter.changes(list)).toHaveLength(1);

        expect(
            reporter.changes([{ name: "Elsewhere", tasks: [item("First", "pending")] }]),
        ).toEqual([]);
    });

    test("clearing the list reports a plan with no entries", () => {
        const reporter = new PlanReporter();
        reporter.changes(list);

        expect(reporter.changes([{ name: "Tasks", tasks: [] }])).toEqual([
            { sessionUpdate: "plan", entries: [] },
        ]);
    });

    test("the current plan is always reported, and later changes compare against it", () => {
        const reporter = new PlanReporter();

        expect(reporter.current([])).toEqual({ sessionUpdate: "plan", entries: [] });
        expect(reporter.current(list)).toEqual({
            sessionUpdate: "plan",
            entries: [{ content: "First", priority: "medium", status: "pending" }],
        });
        expect(reporter.changes(list)).toEqual([]);
    });
});
