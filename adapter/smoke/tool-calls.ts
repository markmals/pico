import type {
    SessionUpdate,
    ToolCallContent,
    ToolCallLocation,
    ToolCallStatus,
    ToolKind,
} from "@agentclientprotocol/sdk";

import path from "node:path";

/** A tool call as the client sees it after every update for it has been applied. */
export interface ToolCallRecord {
    toolCallId: string;
    title: string;
    kind: ToolKind | undefined;
    status: ToolCallStatus | undefined;
    locations: ToolCallLocation[];
    content: ToolCallContent[];
    rawInput: unknown;
    rawOutput: unknown;
}

/**
 * Replays a turn's updates into one record per tool call.
 *
 * Only a `tool_call` update opens a record. A `tool_call_update` for a call that was never
 * opened is left out, which shows up as a missing or unfinished tool call in the checks rather
 * than as an invented one.
 */
export function collectToolCalls(updates: SessionUpdate[]): ToolCallRecord[] {
    let calls = new Map<string, ToolCallRecord>();

    for (let update of updates) {
        if (update.sessionUpdate === "tool_call") {
            calls.set(update.toolCallId, {
                toolCallId: update.toolCallId,
                title: update.title,
                kind: update.kind,
                status: update.status,
                locations: update.locations ?? [],
                content: update.content ?? [],
                rawInput: update.rawInput,
                rawOutput: update.rawOutput,
            });
            continue;
        }

        if (update.sessionUpdate !== "tool_call_update") continue;
        let call = calls.get(update.toolCallId);
        if (call === undefined) continue;

        if (update.title != null) call.title = update.title;
        if (update.kind != null) call.kind = update.kind;
        if (update.status != null) call.status = update.status;
        if (update.locations != null) call.locations = update.locations;
        if (update.content != null) call.content = update.content;
        if (update.rawInput !== undefined) call.rawInput = update.rawInput;
        if (update.rawOutput !== undefined) call.rawOutput = update.rawOutput;
    }

    return [...calls.values()];
}

/** The assistant text streamed during a turn. */
export function agentText(updates: SessionUpdate[]): string {
    let text = "";
    for (let update of updates) {
        if (update.sessionUpdate !== "agent_message_chunk") continue;
        if (update.content.type === "text") text += update.content.text;
    }
    return text;
}

/** The text content a tool call reported. */
export function textOf(call: ToolCallRecord): string {
    let text = "";
    for (let entry of call.content) {
        if (entry.type !== "content") continue;
        if (entry.content.type === "text") text += entry.content.text;
    }
    return text;
}

export function editCallProblem(
    calls: ToolCallRecord[],
    file: string,
    written: string,
): string | null {
    let call = calls.find(candidate => candidate.kind === "edit");
    if (call === undefined) return "no tool call with kind edit";
    return (
        statusProblem(call, "completed") ??
        locationProblem(call, file) ??
        diffProblem(call, file, written)
    );
}

export function readCallProblem(calls: ToolCallRecord[], file: string): string | null {
    let call = calls.find(candidate => candidate.kind === "read");
    if (call === undefined) return "no tool call with kind read";
    return statusProblem(call, "completed") ?? locationProblem(call, file);
}

export function commandCallProblem(
    calls: ToolCallRecord[],
    command: string,
    status: ToolCallStatus,
): string | null {
    let call = commandCall(calls, command);
    if (call === undefined) return `no tool call with kind execute for ${JSON.stringify(command)}`;
    return statusProblem(call, status);
}

export function commandOutputProblem(
    calls: ToolCallRecord[],
    command: string,
    output: string,
): string | null {
    let call = commandCall(calls, command);
    if (call === undefined) return `no tool call with kind execute for ${JSON.stringify(command)}`;
    return textOf(call).includes(output)
        ? null
        : `${call.title}: output does not contain ${JSON.stringify(output)}`;
}

export function commandExitCodeProblem(
    calls: ToolCallRecord[],
    command: string,
    exitCode: number,
): string | null {
    let call = commandCall(calls, command);
    if (call === undefined) return `no tool call with kind execute for ${JSON.stringify(command)}`;
    if (call.rawOutput === null || typeof call.rawOutput !== "object") {
        return `${call.title}: rawOutput is ${JSON.stringify(call.rawOutput) ?? "undefined"}, with no exit code in it`;
    }
    let { exitCode: reported } = call.rawOutput as { exitCode?: unknown };
    return reported === exitCode
        ? null
        : `${call.title}: rawOutput.exitCode is ${String(reported)}, expected ${exitCode}`;
}

// The command the engine was asked to run, not the title: a substring match would accept
// `echo extra; cat pico-smoke.txt` as the command the prompt asked for.
function commandCall(calls: ToolCallRecord[], command: string): ToolCallRecord | undefined {
    return calls.find(
        candidate => candidate.kind === "execute" && commandOf(candidate) === command,
    );
}

function commandOf(call: ToolCallRecord): string | null {
    if (call.rawInput === null || typeof call.rawInput !== "object") return null;
    let { command } = call.rawInput as { command?: unknown };
    return typeof command === "string" ? command.trim() : null;
}

function statusProblem(call: ToolCallRecord, expected: ToolCallStatus): string | null {
    if (call.status === expected) return null;
    return `${call.title}: status ${call.status ?? "missing"}, expected ${expected}`;
}

function locationProblem(call: ToolCallRecord, file: string): string | null {
    if (call.locations.length === 0) return `${call.title}: no locations`;

    let relative = call.locations.find(location => !path.isAbsolute(location.path));
    if (relative !== undefined) return `${call.title}: location ${relative.path} is not absolute`;

    if (!call.locations.some(location => location.path === file)) {
        return `${call.title}: locations do not name ${file}`;
    }
    return null;
}

function diffProblem(call: ToolCallRecord, file: string, written: string): string | null {
    let diff = call.content.find(entry => entry.type === "diff");
    if (diff === undefined) return `${call.title}: no diff content`;
    if (diff.path !== file) return `${call.title}: diff is for ${diff.path}, expected ${file}`;
    if (!diff.newText.includes(written)) {
        return `${call.title}: diff newText does not contain ${JSON.stringify(written)}`;
    }
    return null;
}
