import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent";

import type { ToolPresentation } from "./tool-presentation.ts";

import {
    resultDetails,
    resultText,
    startLocations,
    textContent,
    toolKind,
    toolTitle,
} from "./tool-call-translation.ts";

export function* replayHistory(
    manager: SessionManager,
    cwd: string,
    presentations: ReadonlyMap<string, ToolPresentation>,
): Generator<SessionUpdate> {
    const opened = new Set<string>();
    const settled = new Set<string>();
    const names = new Map<string, string>();
    const transcript = manager.buildSessionContext({ transcript: true }).messages;
    for (const message of transcript) {
        if (message.role === "user") {
            if (typeof message.content === "string") {
                yield {
                    sessionUpdate: "user_message_chunk",
                    content: { type: "text", text: message.content },
                };
            } else {
                for (const block of message.content) {
                    if (block.type === "text")
                        yield {
                            sessionUpdate: "user_message_chunk",
                            content: { type: "text", text: block.text },
                        };
                }
            }
            continue;
        }
        if (message.role === "assistant") {
            for (const block of message.content) {
                if (block.type === "text") {
                    yield {
                        sessionUpdate: "agent_message_chunk",
                        content: { type: "text", text: block.text },
                    };
                } else if (block.type === "thinking") {
                    yield {
                        sessionUpdate: "agent_thought_chunk",
                        content: { type: "text", text: block.thinking },
                    };
                } else if (block.type === "toolCall" && !opened.has(block.id)) {
                    opened.add(block.id);
                    names.set(block.id, block.name);
                    const saved = presentations.get(block.id);
                    yield saved?.start ?? toolStart(block.id, block.name, block.arguments, cwd);
                }
            }
            continue;
        }
        if (message.role !== "toolResult" || settled.has(message.toolCallId)) continue;
        const id = message.toolCallId;
        const saved = presentations.get(id);
        if (!opened.has(id)) {
            opened.add(id);
            names.set(id, message.toolName);
            yield saved?.start ?? toolStart(id, message.toolName, undefined, cwd);
        }
        settled.add(id);
        // Presentation can be saved before its tool result; a recovered error takes precedence.
        if (!message.isError && saved?.end?.status === "completed") {
            yield saved.end;
        } else {
            const content = [textContent(resultText(message))];
            if (!message.isError && (message.toolName === "write" || message.toolName === "edit")) {
                content.push(
                    textContent(
                        "The historical diff was not retained before the previous process stopped.",
                    ),
                );
            }
            yield {
                sessionUpdate: "tool_call_update",
                toolCallId: id,
                status: message.isError ? "failed" : "completed",
                rawOutput: resultDetails(message),
                content,
            };
        }
    }
    for (const id of opened) {
        if (settled.has(id)) continue;
        yield {
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: "failed",
            content: [
                textContent(
                    `The previous process ended before ${names.get(id) ?? "this tool"} returned; its outcome is unknown.`,
                ),
            ],
        };
    }
}

function toolStart(id: string, name: string, args: unknown, cwd: string): SessionUpdate {
    const locations = startLocations(name, args, cwd);
    return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        name,
        title: toolTitle(name, args, undefined, undefined),
        kind: toolKind(name),
        status: "in_progress",
        ...(args === undefined ? {} : { rawInput: args }),
        ...(locations.length === 0 ? {} : { locations }),
    };
}
