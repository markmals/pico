// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-event-mapper.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";

import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls/router";
import {
    expandPath,
    resolveToCwd,
    splitPathAndSelPreferringLiteralSync,
} from "@oh-my-pi/pi-coding-agent/tools/path-utils";

import type { McpToolIdentity, RecordedChange } from "../engine/pico-session.ts";

/** Selectors that name the first line the read window starts at: `50`, `50-80`, `50-`, `50+30`. */
const STARTING_LINE = /^(\d+)(?:-\d*|\+\d+)?$/;

/** Past this much text a change is named rather than shown, as the engine's own recorder does. */
const MAX_DIFF_BYTES = 1024 * 1024;

const PRUNED_BY_OMP = "Oh My Pi did not keep the text of an edit this large";

export function toolKind(toolName: string): ToolKind {
    switch (toolName) {
        case "read":
            return "read";
        case "grep":
        case "glob":
            return "search";
        case "edit":
        case "write":
            return "edit";
        case "bash":
            return "execute";
        case "web_search":
            return "fetch";
        default:
            return "other";
    }
}

export function toolTitle(
    toolName: string,
    args: unknown,
    intent: string | undefined,
    mcpTool: McpToolIdentity | undefined,
): string {
    if (toolName === "bash") {
        const command = stringProperty(args, "command");
        if (command) return command;
    }
    const statedIntent = intent?.trim();
    if (statedIntent) return statedIntent;

    const subject =
        stringProperty(args, "path") ??
        stringProperty(args, "pattern") ??
        stringProperty(args, "query");
    if (subject) return subject;

    // The server and tool come from the connection that mounted the tool. Splitting
    // the minted `mcp__<server>_<tool>` name back apart guesses at a boundary the
    // sanitizer already erased.
    return mcpTool ? `${mcpTool.server}: ${mcpTool.tool}` : toolName;
}

/** Locations a call announces before it runs; `edit` names its files only in its patch text. */
export function startLocations(toolName: string, args: unknown, cwd: string): ToolCallLocation[] {
    const rawPath = stringProperty(args, "path");
    if (!rawPath) return [];
    const location =
        toolName === "read" ? readLocation(rawPath, cwd) : fileLocation(toolName, rawPath, cwd);
    return location ? [location] : [];
}

/** What an `edit` changed, and every file it affected. */
export interface EditedFiles {
    /** One entry per file whose content the result describes, in result order. */
    changes: RecordedChange[];
    /** Those files plus the ones a move emptied, which have no content of their own. */
    locations: ToolCallLocation[];
}

/**
 * What an `edit` result says it changed, one entry per file, in result order.
 *
 * The text comes from the engine's own result: a single-file edit reports on
 * `details`, a multi-file edit on `details.perFileResults`. A file whose text is
 * absent or unusable carries the reason instead of a diff.
 */
export function editedFiles(details: unknown, cwd: string): EditedFiles {
    const changes: RecordedChange[] = [];
    const locations: ToolCallLocation[] = [];
    for (const entry of editEntries(details)) {
        const path = resolveLocationPath(stringProperty(entry, "path"), cwd);
        if (!path) continue;
        const change = describeEdit(entry, path);
        if (change) changes.push(change);
        locations.push({ path });
        // A move leaves the origin behind: it is affected, but its content is now
        // the destination's, so there is nothing to diff for it.
        const origin = resolveLocationPath(stringProperty(entry, "sourcePath"), cwd);
        if (origin && origin !== path) locations.push({ path: origin });
    }
    return { changes, locations };
}

function describeEdit(entry: unknown, path: string): RecordedChange | undefined {
    const oldText = textProperty(entry, "oldText");
    const newText = textProperty(entry, "newText");
    if (oldText === undefined && newText === undefined) {
        return property(entry, "snapshotsPruned") === true
            ? { path, noDiff: PRUNED_BY_OMP }
            : undefined;
    }
    // A removal reports what it replaced and nothing after it.
    const replaced = oldText ?? null;
    const written = newText ?? "";
    if (Buffer.byteLength(replaced ?? "") + Buffer.byteLength(written) > MAX_DIFF_BYTES) {
        return { path, noDiff: "it is larger than 1 MiB" };
    }
    if ((replaced ?? "").includes("\0") || written.includes("\0")) {
        return { path, noDiff: "it is a binary file" };
    }
    return { path, oldText: replaced, newText: written };
}

export function textContent(text: string): ToolCallContent {
    return { type: "content", content: { type: "text", text } };
}

/** The model-visible text of a tool result or partial result. */
export function resultText(result: unknown): string {
    const content = property(result, "content");
    if (!Array.isArray(content)) return "";
    return content.map(block => stringProperty(block, "text") ?? "").join("");
}

export function resultDetails(result: unknown): unknown {
    return property(result, "details");
}

function property(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    return (value as Record<string, unknown>)[key];
}

export function stringProperty(value: unknown, key: string): string | undefined {
    const candidate = property(value, key);
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/** Like {@link stringProperty}, but an empty string is a value: a file can be emptied. */
function textProperty(value: unknown, key: string): string | undefined {
    const candidate = property(value, key);
    return typeof candidate === "string" ? candidate : undefined;
}

/**
 * The file a path argument names, or nothing.
 *
 * A location is a navigation target an editor opens, so anything Pico cannot
 * turn into a real path — an internal URL (`xd://`, `local:/x.md`), a web
 * address, a spelling OMP rejects — is published as no location at all.
 * Throwing here would be worse than silence: the engine swallows a subscriber's
 * exception, and the whole tool call would go unreported.
 */
function resolveLocationPath(rawPath: string | undefined, cwd: string): string | undefined {
    if (!rawPath) return undefined;
    try {
        if (InternalUrlRouter.instance().canHandle(expandPath(rawPath))) return undefined;
        return resolveToCwd(rawPath, cwd);
    } catch {
        return undefined;
    }
}

function fileLocation(
    toolName: string,
    rawPath: string,
    cwd: string,
): ToolCallLocation | undefined {
    if (toolName !== "write" && toolName !== "grep" && toolName !== "glob") return undefined;
    const path = resolveLocationPath(rawPath, cwd);
    return path ? { path } : undefined;
}

function readLocation(rawPath: string, cwd: string): ToolCallLocation | undefined {
    const { path: filePath, sel } = splitSelector(rawPath, cwd);
    const path = resolveLocationPath(filePath, cwd);
    if (!path) return undefined;
    const startingLine = sel === undefined ? null : STARTING_LINE.exec(sel);
    return startingLine ? { path, line: Number(startingLine[1]) } : { path };
}

function splitSelector(rawPath: string, cwd: string): { path: string; sel?: string } {
    try {
        return splitPathAndSelPreferringLiteralSync(rawPath, cwd);
    } catch {
        return { path: rawPath };
    }
}

/** A single-file edit reports on `details` itself; a multi-file edit reports `perFileResults`. */
function editEntries(details: unknown): unknown[] {
    const perFileResults = property(details, "perFileResults");
    return Array.isArray(perFileResults) ? perFileResults : [details];
}
