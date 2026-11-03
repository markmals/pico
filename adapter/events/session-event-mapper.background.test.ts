import type { SessionUpdate, ToolCallContent, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { describe, expect, test } from "bun:test";

import {
    backgroundDetails,
    toolExecutionEnd,
    toolExecutionStart,
    toolExecutionUpdate,
    toolResult,
} from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

/** What Oh My Pi tells the model when a command moves to the background. */
const NOTICE =
    "Backgrounded as job bg_1 (bash). The job runs on its own. Do NOT poll for it; you will be told when it ends.";

function newMapper(): SessionEventMapper {
    return new SessionEventMapper({
        cwd: "/workspace",
        takeChanges: () => [],
        mcpToolIdentity: () => undefined,
    });
}

function toolCallUpdate(update: SessionUpdate | undefined): ToolCallUpdate {
    expect(update?.sessionUpdate).toBe("tool_call_update");
    return update as SessionUpdate & { sessionUpdate: "tool_call_update" };
}

function textContent(text: string): ToolCallContent {
    return { type: "content", content: { type: "text", text } };
}

describe("proposal.0008 a command that moves to the background", () => {
    test("keeps running, showing the output so far and its job", () => {
        const mapper = newMapper();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "make test" },
            }),
        );
        mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult("building\n"),
            }),
        );

        const updates = mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: "bash",
                result: toolResult(NOTICE, backgroundDetails("running")),
            }),
        );

        expect(updates).toHaveLength(1);
        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("in_progress");
        expect(update.content).toEqual([
            textContent("building\n"),
            textContent("Running in the background as job bg_1."),
        ]);
    });

    test("shows only its job when the command has printed nothing", () => {
        const mapper = newMapper();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "sleep 300" },
            }),
        );
        mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult(""),
            }),
        );

        const updates = mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: "bash",
                result: toolResult(NOTICE, backgroundDetails("running", "bg_2")),
            }),
        );

        expect(toolCallUpdate(updates[0]).content).toEqual([
            textContent("Running in the background as job bg_2."),
        ]);
    });
});

/** A `bash` call whose command has moved to job `bg_1`, after printing `output`. */
function backgroundedCall(output = ""): SessionEventMapper {
    const mapper = newMapper();
    mapper.map(
        toolExecutionStart({
            toolCallId: "call-1",
            toolName: "bash",
            args: { command: "make test" },
        }),
    );
    if (output) {
        mapper.map(
            toolExecutionUpdate({
                toolCallId: "call-1",
                toolName: "bash",
                partialResult: toolResult(output),
            }),
        );
    }
    mapper.map(
        toolExecutionEnd({
            toolCallId: "call-1",
            toolName: "bash",
            result: toolResult(NOTICE, backgroundDetails("running")),
        }),
    );
    return mapper;
}

/** One of the job's own frames: the output so far, and the state the job is in. */
function jobFrame(
    mapper: SessionEventMapper,
    state: "running" | "completed" | "failed" | "cancelled",
    text: string,
    rest: Record<string, unknown> = {},
): SessionUpdate[] {
    return mapper.map(
        toolExecutionUpdate({
            toolCallId: "call-1",
            toolName: "bash",
            partialResult: toolResult(text, backgroundDetails(state, "bg_1", rest)),
        }),
    );
}

describe("proposal.0008 a running background job", () => {
    test("replaces its call's content with the output so far and its job", () => {
        const mapper = backgroundedCall("building\n");

        const updates = jobFrame(mapper, "running", "building\ntesting\n");

        expect(updates).toHaveLength(1);
        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBeUndefined();
        expect(update.content).toEqual([
            textContent("building\ntesting\n"),
            textContent("Running in the background as job bg_1."),
        ]);
    });

    test("settles its call when the job ends, with the job's final output", () => {
        const mapper = backgroundedCall("building\n");

        const updates = jobFrame(mapper, "completed", "line1\nline2\n\n\nWall time: 1.08 seconds", {
            exitCode: 0,
        });

        expect(updates).toHaveLength(1);
        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("completed");
        expect(update.content).toEqual([textContent("line1\nline2\n\n\nWall time: 1.08 seconds")]);
        expect(update.rawOutput).toEqual({
            async: { state: "completed", jobId: "bg_1", type: "bash" },
            exitCode: 0,
        });
    });

    test("fails its call when the job is cancelled", () => {
        const mapper = backgroundedCall();

        const updates = jobFrame(mapper, "cancelled", "[Command cancelled]\n");

        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("failed");
        expect(update.content).toEqual([textContent("[Command cancelled]\n")]);
    });

    test("fails its call when the command exits with an error", () => {
        const mapper = backgroundedCall();

        const updates = jobFrame(
            mapper,
            "failed",
            "line1\nline2\n\n\nWall time: 1.08 seconds\n\nCommand exited with code 3",
            { exitCode: 3 },
        );

        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("failed");
        expect(update.content).toEqual([
            textContent("line1\nline2\n\n\nWall time: 1.08 seconds\n\nCommand exited with code 3"),
        ]);
        expect(update.rawOutput).toEqual({
            async: { state: "failed", jobId: "bg_1", type: "bash" },
            exitCode: 3,
        });
    });

    test("fails its call when the command runs past its time limit", () => {
        const mapper = backgroundedCall();

        const updates = jobFrame(
            mapper,
            "failed",
            "[Command timed out after 1 seconds]\n\n\nWall time: 1.03 seconds",
            { timedOut: true },
        );

        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("failed");
        expect(update.content).toEqual([
            textContent("[Command timed out after 1 seconds]\n\n\nWall time: 1.03 seconds"),
        ]);
        expect(update.rawOutput).toEqual({
            async: { state: "failed", jobId: "bg_1", type: "bash" },
            timedOut: true,
        });
    });

    test("reports nothing for the frames that follow its outcome", () => {
        const mapper = backgroundedCall();
        jobFrame(mapper, "completed", "done\n");

        expect(jobFrame(mapper, "running", "done\nmore\n")).toEqual([]);
        expect(jobFrame(mapper, "cancelled", "[Command cancelled]\n")).toEqual([]);
        expect(mapper.closeOpenToolCalls()).toEqual([]);
    });

    test("is cancelled with the turn's other open calls while it still runs", () => {
        const mapper = backgroundedCall("building\n");

        expect(mapper.closeOpenToolCalls()).toEqual([
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "call-1",
                status: "failed",
                content: [textContent("Cancelled")],
            },
        ]);
    });

    test("never shows the model-facing notice to the user", () => {
        const mapper = backgroundedCall("building\n");
        const updates = [
            ...jobFrame(mapper, "running", "building\ntesting\n"),
            ...jobFrame(mapper, "completed", "building\ntesting\nok\n"),
        ];

        expect(JSON.stringify(updates)).not.toContain("Backgrounded as job");
    });

    test("leaves a command that stayed in the foreground settled by its own end", () => {
        const mapper = newMapper();
        mapper.map(
            toolExecutionStart({
                toolCallId: "call-1",
                toolName: "bash",
                args: { command: "echo hi" },
            }),
        );
        const ended = mapper.map(
            toolExecutionEnd({
                toolCallId: "call-1",
                toolName: "bash",
                result: toolResult("hi\n", { exitCode: 0 }),
            }),
        );

        expect(toolCallUpdate(ended[0]).status).toBe("completed");
        expect(jobFrame(mapper, "running", "hi\n")).toEqual([]);
    });
});

/** An open `wait` call, before any job snapshot has reached it. */
function waitingCall(): SessionEventMapper {
    const mapper = newMapper();
    mapper.map(toolExecutionStart({ toolCallId: "wait-1", toolName: "wait", args: {} }));
    return mapper;
}

/** One of `wait`'s progress frames: empty text with the jobs it is waiting on. */
function waitSnapshot(
    mapper: SessionEventMapper,
    jobs: Array<Record<string, unknown>>,
): SessionUpdate[] {
    return mapper.map(
        toolExecutionUpdate({
            toolCallId: "wait-1",
            toolName: "wait",
            partialResult: toolResult("", { op: "wait", jobs }),
        }),
    );
}

describe("proposal.0008 the wait call", () => {
    test("is reported as waiting for background jobs when the model states no intent", () => {
        const mapper = newMapper();

        const updates = mapper.map(
            toolExecutionStart({ toolCallId: "wait-1", toolName: "wait", args: {} }),
        );

        expect(updates).toEqual([
            {
                sessionUpdate: "tool_call",
                toolCallId: "wait-1",
                name: "wait",
                title: "Wait for background jobs",
                kind: "other",
                status: "in_progress",
                rawInput: {},
            },
        ]);
    });

    test("keeps the intent the model stated as its title", () => {
        const mapper = newMapper();

        const updates = mapper.map(
            toolExecutionStart({
                toolCallId: "wait-1",
                toolName: "wait",
                args: {},
                intent: "Waiting for the test run",
            }),
        );

        expect(updates[0]).toMatchObject({ title: "Waiting for the test run" });
    });

    test("shows one line per job it is waiting for", () => {
        const mapper = waitingCall();

        const updates = waitSnapshot(mapper, [
            { id: "bg_1", type: "bash", status: "running", label: "make test" },
            { id: "bg_2", type: "bash", status: "completed", label: "./slow.sh" },
        ]);

        expect(updates).toHaveLength(1);
        expect(toolCallUpdate(updates[0]).content).toEqual([
            textContent("bg_1 — running — make test\nbg_2 — completed — ./slow.sh"),
        ]);
    });

    test("reports nothing while the jobs it lists read the same", () => {
        const mapper = waitingCall();
        const jobs = [{ id: "bg_1", type: "bash", status: "running", label: "make test" }];
        waitSnapshot(mapper, jobs);

        expect(waitSnapshot(mapper, jobs)).toEqual([]);
        expect(
            waitSnapshot(mapper, [
                { id: "bg_1", type: "bash", status: "completed", label: "make test" },
            ]),
        ).toHaveLength(1);
    });

    test("reports nothing when it has no job to list", () => {
        const mapper = waitingCall();

        expect(waitSnapshot(mapper, [])).toEqual([]);
    });

    test("settles with the report it returned to the model", () => {
        const mapper = waitingCall();
        waitSnapshot(mapper, [{ id: "bg_1", type: "bash", status: "running", label: "make test" }]);
        const report = "## Completed (1)\n\n### bg_1 [bash] — completed\n";

        const updates = mapper.map(
            toolExecutionEnd({
                toolCallId: "wait-1",
                toolName: "wait",
                result: toolResult(report, { op: "wait" }),
            }),
        );

        const update = toolCallUpdate(updates[0]);
        expect(update.status).toBe("completed");
        expect(update.content).toEqual([textContent(report)]);
    });
});
