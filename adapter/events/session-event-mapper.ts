// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-event-mapper.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

import type { PicoSession, RecordedChange } from "../engine/pico-session.ts";

import {
    editDiffs,
    editedFiles,
    resultDetails,
    resultText,
    startLocations,
    textContent,
    toolKind,
    toolTitle,
} from "./tool-call-translation.ts";

type SessionView = Pick<PicoSession, "cwd" | "takeRecordedChanges" | "mcpToolIdentity">;

type StreamDelta = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];

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
                return this.#reported.has(event.toolCallId)
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
        // Only `write` and `edit` are recorded, and the record is consumed even when
        // the result is an error, so nothing the engine kept for this call outlives it.
        const changed =
            toolName === "write" || toolName === "edit"
                ? this.#session.takeRecordedChanges(toolCallId)
                : [];
        const update: SessionUpdate = {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: isError ? "failed" : "completed",
            rawOutput: details,
            content: isError
                ? [textContent(resultText(result))]
                : this.#successContent(toolName, result, details, changed),
        };
        if (!isError && toolName === "edit") {
            const locations =
                changed.length > 0
                    ? changed.map(change => ({ path: change.path }))
                    : editedFiles(details, this.#session.cwd);
            if (locations.length > 0) update.locations = locations;
        }
        return [update];
    }

    #successContent(
        toolName: string,
        result: unknown,
        details: unknown,
        changed: readonly RecordedChange[],
    ): ToolCallContent[] {
        if (changed.length > 0) {
            return changed.map(change => ({
                type: "diff",
                path: change.path,
                oldText: change.oldText,
                newText: change.newText,
            }));
        }
        if (toolName === "edit") {
            const diffs = editDiffs(details, this.#session.cwd);
            if (diffs.length > 0) return diffs;
        }
        return [textContent(resultText(result))];
    }
}
