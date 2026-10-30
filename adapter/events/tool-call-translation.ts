// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-event-mapper.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";

import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls/router";
import {
    expandPath,
    resolveToCwd,
    splitPathAndSelPreferringLiteralSync,
} from "@oh-my-pi/pi-coding-agent/tools/path-utils";

const MCP_PREFIX = "mcp__";

/** Selectors that name the first line the read window starts at: `50`, `50-80`, `50-`, `50+30`. */
const STARTING_LINE = /^(\d+)(?:-\d*|\+\d+)?$/;

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

export function toolTitle(toolName: string, args: unknown, intent: string | undefined): string {
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

    const mcpTool = splitMcpToolName(toolName);
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

/** The files an `edit` result reports changing, in result order. */
export function editedFiles(details: unknown, cwd: string): ToolCallLocation[] {
    const locations: ToolCallLocation[] = [];
    for (const entry of editEntries(details)) {
        const path = resolveLocationPath(stringProperty(entry, "path"), cwd);
        if (path) locations.push({ path });
    }
    return locations;
}

export function editDiffs(details: unknown, cwd: string): ToolCallContent[] {
    const diffs: ToolCallContent[] = [];
    for (const entry of editEntries(details)) {
        const path = resolveLocationPath(stringProperty(entry, "path"), cwd);
        const oldText = stringProperty(entry, "oldText");
        const newText = stringProperty(entry, "newText");
        if (!path || (oldText === undefined && newText === undefined)) continue;
        diffs.push({ type: "diff", path, oldText: oldText ?? null, newText: newText ?? "" });
    }
    return diffs;
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

function stringProperty(value: unknown, key: string): string | undefined {
    const candidate = property(value, key);
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
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

function splitMcpToolName(toolName: string): { server: string; tool: string } | undefined {
    if (!toolName.startsWith(MCP_PREFIX)) return undefined;
    const suffix = toolName.slice(MCP_PREFIX.length);
    const boundary = suffix.indexOf("_");
    if (boundary <= 0 || boundary === suffix.length - 1) return undefined;
    return { server: suffix.slice(0, boundary), tool: suffix.slice(boundary + 1) };
}
