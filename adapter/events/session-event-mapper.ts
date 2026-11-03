// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-event-mapper.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

import type { PicoSession, RecordedChange } from "../engine/pico-session.ts";
import type { EditedFiles } from "./tool-call-translation.ts";

import {
    backgroundContent,
    backgroundJob,
    backgroundOutcome,
    editedFiles,
    failureText,
    jobLines,
    resultDetails,
    resultText,
    startLocations,
    textContent,
    toolKind,
    toolTitle,
} from "./tool-call-translation.ts";

type SessionView = Pick<PicoSession, "cwd" | "takeChanges" | "mcpToolIdentity">;

type StreamDelta = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];

/** The tools whose file writes the engine attributes to their call. */
const CHANGING_TOOLS = ["write", "edit"];

const NOTHING_CHANGED: EditedFiles = { changes: [], locations: [] };

/**
 * Translates one session's engine events into ACP updates.
 *
 * The mapper owns the tool-call invariant: a call is reported once, nothing is
 * reported about it before that, and it settles once — whether the engine ends
 * it, repeats itself, or the turn is cancelled out from under it. A `todo`
 * call's whole effect reaches the client as its plan, so it is reported only
 * when it fails or is cancelled (proposal.0006). A command that moves to a
 * background job is the one call the engine's end event does not settle: the
 * job's own updates carry its output and its outcome (proposal.0008).
 */
export class SessionEventMapper {
    readonly #session: SessionView;
    readonly #reported = new Set<string>();
    readonly #running = new Set<string>();
    /** Running `todo` calls, each with the `tool_call` it is reported by if it does not succeed. */
    readonly #heldTodoCalls = new Map<string, SessionUpdate>();
    /** Calls whose command moved to a background job, by that job's id. */
    readonly #backgroundJobs = new Map<string, string>();
    /** The text each running call last showed, which a job line then follows. */
    readonly #progressText = new Map<string, string>();

    constructor(session: SessionView) {
        this.#session = session;
    }

    map(event: AgentSessionEvent): SessionUpdate[] {
        switch (event.type) {
            case "message_update":
                return this.#mapStreamDelta(event.assistantMessageEvent);
            case "tool_execution_start":
                return this.#startToolCall(
                    event.toolCallId,
                    event.toolName,
                    event.args,
                    event.intent,
                );
            case "tool_execution_update":
                return this.#updateToolCall(event.toolCallId, event.toolName, event.partialResult);
            case "tool_execution_end":
                return this.#endToolCall(
                    event.toolCallId,
                    event.toolName,
                    event.result,
                    event.isError === true,
                );
            default:
                return [];
        }
    }

    closeOpenToolCalls(): SessionUpdate[] {
        const updates = [...this.#running].flatMap((toolCallId): SessionUpdate[] => {
            const cancelled: SessionUpdate = {
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: "failed",
                content: [textContent("Cancelled")],
            };
            const held = this.#heldTodoCalls.get(toolCallId);
            return held ? [held, cancelled] : [cancelled];
        });
        this.#running.clear();
        this.#heldTodoCalls.clear();
        this.#backgroundJobs.clear();
        this.#progressText.clear();
        return updates;
    }

    #updateToolCall(toolCallId: string, toolName: string, partialResult: unknown): SessionUpdate[] {
        // A killed command still drains its output after the engine reported the
        // end; a settled call must not come back to life.
        if (!this.#running.has(toolCallId) || this.#heldTodoCalls.has(toolCallId)) return [];
        const jobId = this.#backgroundJobs.get(toolCallId);
        if (jobId !== undefined) return this.#reportJob(toolCallId, jobId, partialResult);
        if (toolName === "wait") {
            return this.#reportWaitedJobs(toolCallId, jobLines(resultDetails(partialResult)));
        }
        const text = resultText(partialResult);
        this.#progressText.set(toolCallId, text);
        return [{ sessionUpdate: "tool_call_update", toolCallId, content: [textContent(text)] }];
    }

    /**
     * `wait`'s own progress: the jobs it is waiting on, which carry no output of
     * their own. A snapshot that reads as the last one leaves the call untouched,
     * so it does not change every half second.
     */
    #reportWaitedJobs(toolCallId: string, lines: string): SessionUpdate[] {
        if (!lines || lines === this.#progressText.get(toolCallId)) return [];
        this.#progressText.set(toolCallId, lines);
        return [{ sessionUpdate: "tool_call_update", toolCallId, content: [textContent(lines)] }];
    }

    /** A job's own frame: its output while it runs, and its outcome when it ends. */
    #reportJob(toolCallId: string, jobId: string, partialResult: unknown): SessionUpdate[] {
        const text = resultText(partialResult);
        const details = resultDetails(partialResult);
        const outcome = backgroundOutcome(backgroundJob(details));
        if (outcome) {
            this.#closeCall(toolCallId);
            return [
                {
                    sessionUpdate: "tool_call_update",
                    toolCallId,
                    status: outcome,
                    rawOutput: details,
                    content: [textContent(text)],
                },
            ];
        }
        this.#progressText.set(toolCallId, text);
        return [
            {
                sessionUpdate: "tool_call_update",
                toolCallId,
                content: backgroundContent(text, jobId),
            },
        ];
    }

    #closeCall(toolCallId: string): void {
        this.#running.delete(toolCallId);
        this.#backgroundJobs.delete(toolCallId);
        this.#progressText.delete(toolCallId);
    }

    #mapStreamDelta(delta: StreamDelta): SessionUpdate[] {
        if (delta.type === "text_delta") {
            return [
                {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: delta.delta },
                },
            ];
        }
        if (delta.type === "thinking_delta") {
            return [
                {
                    sessionUpdate: "agent_thought_chunk",
                    content: { type: "text", text: delta.delta },
                },
            ];
        }
        return [];
    }

    #startToolCall(
        toolCallId: string,
        toolName: string,
        args: unknown,
        intent: string | undefined,
    ): SessionUpdate[] {
        if (this.#reported.has(toolCallId)) return [];
        this.#reported.add(toolCallId);
        this.#running.add(toolCallId);

        const locations = startLocations(toolName, args, this.#session.cwd);
        const update: SessionUpdate = {
            sessionUpdate: "tool_call",
            toolCallId,
            name: toolName,
            title: toolTitle(toolName, args, intent, this.#session.mcpToolIdentity(toolName)),
            kind: toolKind(toolName),
            status: "in_progress",
            rawInput: args,
        };
        if (locations.length > 0) update.locations = locations;
        if (toolName !== "todo") return [update];
        this.#heldTodoCalls.set(toolCallId, update);
        return [];
    }

    #endToolCall(
        toolCallId: string,
        toolName: string,
        result: unknown,
        isError: boolean,
    ): SessionUpdate[] {
        if (!this.#running.has(toolCallId)) return [];

        const details = resultDetails(result);
        const job = backgroundJob(details);
        // The command now runs as a job: its call stays open and shows the job's
        // own output and outcome, not Oh My Pi's model-facing notice.
        if (job?.state === "running") return this.#startBackgroundJob(toolCallId, job.jobId);
        this.#closeCall(toolCallId);

        // The writes attributed to this call are consumed even when it failed, so
        // none of them can be reported against a later call to the same file.
        const written = CHANGING_TOOLS.includes(toolName)
            ? this.#session.takeChanges(toolCallId)
            : [];
        const changed = isError ? NOTHING_CHANGED : this.#changedFiles(toolName, details, written);
        const update: SessionUpdate = {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: isError ? "failed" : "completed",
            rawOutput: details,
            content: isError
                ? [textContent(failureText(toolName, result))]
                : changeContent(changed.changes, result),
        };
        if (changed.locations.length > 0) update.locations = changed.locations;
        const held = this.#heldTodoCalls.get(toolCallId);
        if (!held) return [update];
        this.#heldTodoCalls.delete(toolCallId);
        return isError ? [held, update] : [];
    }

    #startBackgroundJob(toolCallId: string, jobId: string): SessionUpdate[] {
        this.#backgroundJobs.set(toolCallId, jobId);
        return [
            {
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: "in_progress",
                content: backgroundContent(this.#progressText.get(toolCallId) ?? "", jobId),
            },
        ];
    }

    #changedFiles(
        toolName: string,
        details: unknown,
        written: readonly RecordedChange[],
    ): EditedFiles {
        // A `write` is exactly the writes the engine attributed to it; its result
        // names a path an extension may have replaced.
        if (toolName === "write") {
            return { changes: [...written], locations: written.map(({ path }) => ({ path })) };
        }
        return toolName === "edit"
            ? editedFiles(details, this.#session.cwd, written)
            : NOTHING_CHANGED;
    }
}

function changeContent(changed: readonly RecordedChange[], result: unknown): ToolCallContent[] {
    const diffs: ToolCallContent[] = [];
    // A file the engine cannot show as a diff says why instead; the others still
    // show theirs.
    const undiffable: ToolCallContent[] = [];
    for (const change of changed) {
        if ("newText" in change) {
            diffs.push({
                type: "diff",
                path: change.path,
                oldText: change.oldText,
                newText: change.newText,
            });
        } else {
            undiffable.push(textContent(`No diff for ${change.path}: ${change.noDiff}`));
        }
    }
    return diffs.length > 0
        ? [...diffs, ...undiffable]
        : [textContent(resultText(result)), ...undiffable];
}
