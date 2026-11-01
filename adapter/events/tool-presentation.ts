import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { SessionEntry, SessionManager } from "@oh-my-pi/pi-coding-agent";

import { z } from "@oh-my-pi/pi-coding-agent";

const CUSTOM_TYPE = "pico.tool-presentation";
const location = z.object({ path: z.string(), line: z.number().int().nonnegative().optional() });
const content = z.union([
    z.object({
        type: z.literal("content"),
        content: z.object({ type: z.literal("text"), text: z.string() }),
    }),
    z.object({
        type: z.literal("diff"),
        path: z.string(),
        oldText: z.string().nullable(),
        newText: z.string(),
    }),
]);
const toolCall = z.object({
    sessionUpdate: z.literal("tool_call"),
    toolCallId: z.string().min(1),
    name: z.string(),
    title: z.string(),
    kind: z.enum([
        "read",
        "edit",
        "delete",
        "move",
        "search",
        "execute",
        "think",
        "fetch",
        "switch_mode",
        "other",
    ]),
    status: z.literal("in_progress"),
    rawInput: z.unknown().optional(),
    locations: z.array(location).optional(),
});
const toolResult = z.object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    rawOutput: z.unknown().optional(),
    content: z.array(content).optional(),
    locations: z.array(location).optional(),
});
const record = z.object({ version: z.literal(1), update: z.union([toolCall, toolResult]) });

type SavedStart = z.infer<typeof toolCall>;
type SavedEnd = z.infer<typeof toolResult>;
export interface ToolPresentation {
    start?: SavedStart;
    end?: SavedEnd;
}

export function recordToolPresentation(manager: SessionManager, update: SessionUpdate): void {
    if (
        update.sessionUpdate !== "tool_call" &&
        !(
            update.sessionUpdate === "tool_call_update" &&
            (update.status === "completed" || update.status === "failed")
        )
    )
        return;
    manager.appendCustomEntry(CUSTOM_TYPE, { version: 1, update });
}

export function readToolPresentations(
    entries: readonly SessionEntry[],
): Map<string, ToolPresentation> {
    const presentations = new Map<string, ToolPresentation>();
    for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
        const parsed = record.safeParse(entry.data);
        if (!parsed.success) {
            throw new Error(
                `Invalid or unsupported Pico tool presentation in entry ${entry.id}: ${parsed.error.message}`,
            );
        }
        const update = parsed.data.update;
        const presentation = presentations.get(update.toolCallId) ?? {};
        if (update.sessionUpdate === "tool_call") {
            if (presentation.start)
                throw new Error(`Duplicate saved tool call ${update.toolCallId}`);
            presentation.start = update;
        } else {
            if (presentation.end)
                throw new Error(`Duplicate saved tool result ${update.toolCallId}`);
            presentation.end = update;
        }
        presentations.set(update.toolCallId, presentation);
    }
    return presentations;
}
