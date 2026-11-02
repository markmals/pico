import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";
import type { TodoPhase } from "@oh-my-pi/pi-coding-agent/tools";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { toolCall } from "../engine/testing/session-fixture.ts";
import { toolExecutionStart } from "../events/engine-event-fixtures.ts";
import { removeTemporaryDirectories } from "./engine-harness.ts";
import { fakeSession } from "./fake-session.ts";
import { closeOpenConnections, startPicoSession } from "./session-fixture.ts";
import { SessionRuntime } from "./session-runtime.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

/** Each plan the client received, as `[content, status]` pairs. */
function plans(updates: SessionUpdate[]): [string, string][][] {
    return updates.flatMap(update =>
        update.sessionUpdate === "plan"
            ? [update.entries.map((entry): [string, string] => [entry.content, entry.status])]
            : [],
    );
}

function updatesAbout(updates: SessionUpdate[], toolCallId: string): SessionUpdate[] {
    return updates.filter(
        update =>
            (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
            update.toolCallId === toolCallId,
    );
}

function todo(args: Record<string, unknown>, id: string) {
    return { content: [toolCall("todo", args, id)] };
}

describe("proposal.0006 the plan during a turn", () => {
    test("successful todo calls reach the client only as complete plans, one for each change", async () => {
        const session = await startPicoSession([
            todo({ op: "init", items: ["Write the test", "Write the code"] }, "todo-init"),
            todo({ op: "view" }, "todo-view"),
            todo({ op: "done", task: "Write the test" }, "todo-done"),
            { content: ["Finished."] },
        ]);
        expect(plans(session.updates())).toEqual([]);

        const response = await session.prompt("plan the work and do the first part");

        expect(response.stopReason).toBe("end_turn");
        expect(plans(session.updates())).toEqual([
            [
                ["Write the test", "in_progress"],
                ["Write the code", "pending"],
            ],
            [
                ["Write the test", "completed"],
                ["Write the code", "in_progress"],
            ],
        ]);
        for (const id of ["todo-init", "todo-view", "todo-done"]) {
            expect(updatesAbout(session.updates(), id), id).toEqual([]);
        }
    }, 30_000);

    test("a failed todo call is a failed tool call carrying the engine's error, and the plan stays as it was", async () => {
        const session = await startPicoSession([
            todo({ op: "init", items: ["Write the test"] }, "todo-init"),
            todo({ op: "done", task: "Something not on the list" }, "todo-missing"),
            { content: ["Finished."] },
        ]);

        await session.prompt("finish something that is not on the list");

        expect(plans(session.updates())).toEqual([[["Write the test", "in_progress"]]]);
        const failed = updatesAbout(session.updates(), "todo-missing");
        expect(failed.map(update => update.sessionUpdate)).toEqual([
            "tool_call",
            "tool_call_update",
        ]);
        expect(failed[0]).toMatchObject({ name: "todo", kind: "other" });
        expect(failed[1]).toMatchObject({
            status: "failed",
            content: [
                {
                    type: "content",
                    content: {
                        type: "text",
                        text: 'Errors: Task "Something not on the list" not found',
                    },
                },
            ],
        });
    }, 30_000);

    test("dropped items leave the plan and blocked items are labelled pending", async () => {
        const session = await startPicoSession([
            todo({ op: "init", items: ["Build", "Polish", "Ship"] }, "todo-init"),
            todo({ op: "drop", task: "Polish" }, "todo-drop"),
            todo({ op: "block", task: "Ship", reason: "needs review" }, "todo-block"),
            { content: ["Finished."] },
        ]);

        await session.prompt("plan, drop and block");

        expect(plans(session.updates()).at(-1)).toEqual([
            ["Build", "in_progress"],
            ["Ship (blocked: needs review)", "pending"],
        ]);
    }, 30_000);

    test("clearing the list sends a plan with no entries", async () => {
        const session = await startPicoSession([
            todo({ op: "init", items: ["Write the test"] }, "todo-init"),
            todo({ op: "rm" }, "todo-clear"),
            { content: ["Finished."] },
        ]);

        await session.prompt("plan, then clear the list");

        expect(plans(session.updates())).toEqual([[["Write the test", "in_progress"]], []]);
    }, 30_000);

    test("a todo call a cancellation closed is a cancelled failure, and the turn's end reports the list the engine kept", async () => {
        const list: TodoPhase[] = [];
        const sent: SessionNotification[] = [];
        const started = Promise.withResolvers<void>();
        const aborted = Promise.withResolvers<void>();
        const fake = fakeSession("/workspace", {
            todoPhases: () => list,
            prompt: async emit => {
                emit(
                    toolExecutionStart({
                        toolCallId: "todo-1",
                        toolName: "todo",
                        args: { op: "init", items: ["Kept anyway"] },
                    }),
                );
                list.push({
                    name: "Tasks",
                    tasks: [{ content: "Kept anyway", status: "pending" }],
                });
                started.resolve();
                await aborted.promise;
                return true;
            },
            abort: async () => aborted.resolve(),
        });
        const client = {
            notify: async (_method: string, params: SessionNotification) => {
                sent.push(params);
            },
        } as unknown as ConstructorParameters<typeof SessionRuntime>[2];
        const runtime = new SessionRuntime("session-1", fake.session, client);

        const turn = runtime.prompt("plan something");
        await started.promise;
        runtime.cancel();
        expect(await turn).toBe("cancelled");

        const updates = sent.map(notification => notification.update);
        expect(updatesAbout(updates, "todo-1").map(update => update.sessionUpdate)).toEqual([
            "tool_call",
            "tool_call_update",
        ]);
        expect(JSON.stringify(updatesAbout(updates, "todo-1")[1])).toContain("Cancelled");
        expect(plans(updates)).toEqual([[["Kept anyway", "pending"]]]);
        expect(updates.at(-1)?.sessionUpdate).toBe("plan");
    });
});
