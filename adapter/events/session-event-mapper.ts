// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-event-mapper.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

import type { PicoSession, RecordedChange } from "../engine/pico-session.ts";
import type { EditedFiles } from "./tool-call-translation.ts";

import {
    editedFiles,
    resultDetails,
    resultText,
    startLocations,
    stringProperty,
    textContent,
    toolKind,
    toolTitle,
} from "./tool-call-translation.ts";

type SessionView = Pick<PicoSession, "cwd" | "takeWrite" | "mcpToolIdentity">;

type StreamDelta = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];

const NOTHING_CHANGED: EditedFiles = { changes: [], locations: [] };

/**
 * Translates one session's engine events into ACP updates.
 *
 * The mapper owns the tool-call invariant: a call is reported once, nothing is
 * reported about it before that, and it settles once — whether the engine ends
 * it, repeats itself, or the turn is cancelled out from under it.
 */
export class SessionEventMapper {
    readonly #session: SessionView;
    readonly #reported = new Set<string>();
    readonly #running = new Set<string>();

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
                // A killed command still drains its output after the engine reported
                // the end; a settled call must not come back to life.
                return this.#running.has(event.toolCallId)
                    ? [
                          {
                              sessionUpdate: "tool_call_update",
                              toolCallId: event.toolCallId,
                              content: [textContent(resultText(event.partialResult))],
                          },
                      ]
                    : [];
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
        const updates = [...this.#running].map((toolCallId): SessionUpdate => ({
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "failed",
            content: [textContent("Cancelled")],
        }));
        this.#running.clear();
        return updates;
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
        return [update];
    }

    #endToolCall(
        toolCallId: string,
        toolName: string,
        result: unknown,
        isError: boolean,
    ): SessionUpdate[] {
        if (!this.#running.has(toolCallId)) return [];
        this.#running.delete(toolCallId);

        const details = resultDetails(result);
        // A write's record is consumed even when the call failed, so nothing the
        // engine kept for this call outlives it.
        const written = toolName === "write" ? this.#takeWrite(details) : undefined;
        const changed = isError ? NOTHING_CHANGED : this.#changedFiles(toolName, details, written);
        const update: SessionUpdate = {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: isError ? "failed" : "completed",
            rawOutput: details,
            content: isError
                ? [textContent(resultText(result))]
                : changeContent(changed.changes, result),
        };
        if (changed.locations.length > 0) update.locations = changed.locations;
        return [update];
    }

    /** The file a `write` replaced, as the engine recorded it when the tool ran. */
    #takeWrite(details: unknown): RecordedChange | undefined {
        const resolvedPath = stringProperty(details, "resolvedPath");
        return resolvedPath ? this.#session.takeWrite(resolvedPath) : undefined;
    }

    #changedFiles(
        toolName: string,
        details: unknown,
        written: RecordedChange | undefined,
    ): EditedFiles {
        if (toolName === "write") {
            return written
                ? { changes: [written], locations: [{ path: written.path }] }
                : NOTHING_CHANGED;
        }
        // An `edit` reports its own before and after text; nothing else is recorded.
        return toolName === "edit" ? editedFiles(details, this.#session.cwd) : NOTHING_CHANGED;
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
