import type { SessionUpdate, ToolCall, ToolKind } from "@agentclientprotocol/sdk";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpToolIdentity } from "../engine/pico-session.ts";

import { toolExecutionStart } from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

let cwd: string;

beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "pico-mapper-"));
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const a = 1\n");
    writeFileSync(join(cwd, "elsewhere.ts"), "export const b = 2\n");
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function startUpdate(
    toolName: string,
    args: unknown,
    options: { intent?: string; mcpTool?: McpToolIdentity } = {},
): ToolCall & { sessionUpdate: string } {
    const mapper = new SessionEventMapper({
        cwd,
        takeRecordedChanges: () => [],
        mcpToolIdentity: () => options.mcpTool,
    });
    const updates = mapper.map(
        toolExecutionStart({ toolCallId: "call-1", toolName, args, intent: options.intent }),
    );
    expect(updates).toHaveLength(1);
    const update = updates[0] as SessionUpdate & { sessionUpdate: "tool_call" };
    expect(update.sessionUpdate).toBe("tool_call");
    return update;
}

describe("proposal.0001 tool call start", () => {
    test("one tool_call carries the engine id, in_progress status and the raw arguments", () => {
        const args = { command: "bun test", timeout: 30 };

        const update = startUpdate("bash", args);

        expect(update.toolCallId).toBe("call-1");
        expect(update.name).toBe("bash");
        expect(update.status).toBe("in_progress");
        expect(update.rawInput).toEqual(args);
    });

    test.each<[string, ToolKind]>([
        ["read", "read"],
        ["grep", "search"],
        ["glob", "search"],
        ["edit", "edit"],
        ["write", "edit"],
        ["bash", "execute"],
        ["web_search", "fetch"],
        ["mcp__sesh_ask_user", "other"],
        ["mcp__sesh_start_session", "other"],
    ])("%s maps to the %s tool kind", (toolName, kind) => {
        expect(startUpdate(toolName, {}).kind).toBe(kind);
    });
});

describe("proposal.0001 tool call titles", () => {
    test("bash is titled with its command, even when an intent is present", () => {
        expect(
            startUpdate("bash", { command: "cat hello.txt" }, { intent: "Reading the greeting" })
                .title,
        ).toBe("cat hello.txt");
    });

    test("another tool prefers the call's intent", () => {
        expect(
            startUpdate("read", { path: "src/app.ts" }, { intent: "Checking the entry point" })
                .title,
        ).toBe("Checking the entry point");
    });

    test("without an intent, the first path argument titles the call", () => {
        expect(startUpdate("read", { path: "src/app.ts" }).title).toBe("src/app.ts");
    });

    test("without an intent or path, the pattern argument titles the call", () => {
        expect(startUpdate("grep", { pattern: "needle" }).title).toBe("needle");
    });

    test("without an intent, path or pattern, the query argument titles the call", () => {
        expect(startUpdate("web_search", { query: "agent client protocol" }).title).toBe(
            "agent client protocol",
        );
    });

    test("an MCP tool is titled with the server and tool its connection reported", () => {
        expect(
            startUpdate(
                "mcp__my_server_ping",
                { questions: [{ text: "Which one?" }] },
                { mcpTool: { server: "my_server", tool: "ping" } },
            ).title,
        ).toBe("my_server: ping");
    });

    test("an MCP tool the session cannot identify keeps its minted name", () => {
        expect(startUpdate("mcp__my_server_ping", { questions: [] }).title).toBe(
            "mcp__my_server_ping",
        );
    });

    test("a call with nothing else to say is titled with the tool name", () => {
        expect(startUpdate("glob", {}).title).toBe("glob");
    });
});

describe("proposal.0001 tool call locations", () => {
    test("a read location is the file, resolved against the session cwd", () => {
        expect(startUpdate("read", { path: "src/app.ts" }).locations).toEqual([
            { path: join(cwd, "src", "app.ts") },
        ]);
    });

    test("an absolute path is published unchanged", () => {
        const absolute = join(cwd, "elsewhere.ts");

        expect(startUpdate("read", { path: absolute }).locations).toEqual([{ path: absolute }]);
    });

    test.each<[string, number | undefined]>([
        ["src/app.ts:50", 50],
        ["src/app.ts:50-80", 50],
        ["src/app.ts:50+30", 50],
        ["src/app.ts:raw", undefined],
        ["src/app.ts:-5", undefined],
        ["src/app.ts:conflicts", undefined],
        ["src/app.ts:5-16,960-973", undefined],
    ])("a read of %s locates the file without its selector", (path, line) => {
        const file = join(cwd, "src", "app.ts");

        expect(startUpdate("read", { path }).locations).toEqual([
            line === undefined ? { path: file } : { path: file, line },
        ]);
    });

    test("a write location is the file it affects", () => {
        expect(
            startUpdate("write", { path: "src/generated.ts", content: "x\n" }).locations,
        ).toEqual([{ path: join(cwd, "src", "generated.ts") }]);
    });

    test("a grep location is the searched path", () => {
        expect(startUpdate("grep", { pattern: "needle", path: "src" }).locations).toEqual([
            { path: join(cwd, "src") },
        ]);
    });

    test("a glob without a searched path publishes no location", () => {
        expect(startUpdate("glob", { pattern: "**/*.ts" }).locations ?? []).toEqual([]);
    });
});
