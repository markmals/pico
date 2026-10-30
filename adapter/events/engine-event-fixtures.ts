import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

/** Engine events as `AgentSession.subscribe()` delivers them, for mapper tests. */

const ZERO_USAGE: AssistantMessage["usage"] = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "mock",
        provider: "mock",
        model: "mock-model",
        usage: ZERO_USAGE,
        stopReason: "stop",
        timestamp: 0,
    };
}

export function textDelta(delta: string): AgentSessionEvent {
    const partial = assistantMessage([{ type: "text", text: delta }]);
    return {
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial },
    };
}

export function thinkingDelta(delta: string): AgentSessionEvent {
    const partial = assistantMessage([{ type: "thinking", thinking: delta }]);
    return {
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta, partial },
    };
}

/** The model-stream deltas that announce a tool call before the engine executes it. */
export function toolCallStreamDeltas(
    toolName: string,
    args: Record<string, unknown>,
): AgentSessionEvent[] {
    const toolCall = { type: "toolCall" as const, id: "stream-1", name: toolName, arguments: args };
    const partial = assistantMessage([toolCall]);
    return [
        {
            type: "message_update",
            message: partial,
            assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial },
        },
        {
            type: "message_update",
            message: partial,
            assistantMessageEvent: {
                type: "toolcall_delta",
                contentIndex: 0,
                delta: JSON.stringify(args),
                partial,
            },
        },
        {
            type: "message_update",
            message: partial,
            assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall, partial },
        },
    ];
}

export function toolExecutionStart(options: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    intent?: string;
}): AgentSessionEvent {
    return {
        type: "tool_execution_start",
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        args: options.args,
        intent: options.intent,
    };
}

export function toolExecutionUpdate(options: {
    toolCallId: string;
    toolName: string;
    args?: unknown;
    partialResult: unknown;
}): AgentSessionEvent {
    return {
        type: "tool_execution_update",
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        args: options.args ?? {},
        partialResult: options.partialResult,
    };
}

export function toolExecutionEnd(options: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean;
}): AgentSessionEvent {
    return {
        type: "tool_execution_end",
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        result: options.result,
        isError: options.isError,
    };
}

/** A tool result as the engine shapes it: model-visible text plus structured details. */
export function toolResult(
    text: string,
    details: Record<string, unknown> = {},
): Record<string, unknown> {
    return { content: [{ type: "text", text }], details };
}
