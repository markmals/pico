import type { SessionUpdate } from "@agentclientprotocol/sdk";

import { describe, expect, test } from "bun:test";

import { toolExecutionStart } from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

const CWD = "/workspace";

const ROSTER = [
    "read",
    "grep",
    "glob",
    "edit",
    "write",
    "bash",
    "web_search",
    "mcp__sesh_ask_user",
];

/**
 * Path-shaped strings an engine really produces, including OMP's internal-URL
 * spellings: resolving one of those throws, and a throw inside a subscriber is
 * swallowed by the engine, which would lose the tool call entirely.
 */
const PATH_SHAPES = [
    "src/app.ts",
    "/absolute/file.ts",
    "~/notes.md",
    "local:/x.md",
    "local://x.md",
    `${CWD}/local://x.md`,
    "xd://report_issue",
    "skill://writing-skills",
    "agent://all",
    "https://example.test/page",
    "file:///workspace/a.txt",
    "proc://bg_1/kill",
    "",
    "/",
    "..",
    "a".repeat(5_000),
    "weird:name:with:colons",
    "src/app.ts:50",
    "src/app.ts:raw",
];

const VALUE_SHAPES: unknown[] = [
    undefined,
    null,
    0,
    -1,
    true,
    [],
    [1, "two", null],
    {},
    { nested: { deeper: ["x"] } },
    "plain string",
];

function randomSource(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state;
    };
}

function randomArgs(next: () => number): unknown {
    const pick = <T>(choices: T[]): T => choices[next() % choices.length] as T;
    switch (next() % 6) {
        case 0:
            return pick(VALUE_SHAPES);
        case 1:
            return pick(PATH_SHAPES);
        case 2:
            return { path: pick(PATH_SHAPES) };
        case 3:
            return {
                path: pick(VALUE_SHAPES),
                pattern: pick(PATH_SHAPES),
                query: pick(VALUE_SHAPES),
            };
        case 4:
            return {
                command: pick(VALUE_SHAPES),
                path: pick(PATH_SHAPES),
                input: pick(PATH_SHAPES),
            };
        default:
            return {
                path: pick(PATH_SHAPES),
                nested: { path: pick(PATH_SHAPES) },
                items: [pick(PATH_SHAPES)],
            };
    }
}

describe("proposal.0001 tool call translation is total", () => {
    test("for any arguments a roster tool is called with, the call is still reported", () => {
        const next = randomSource(7);
        for (let attempt = 0; attempt < 500; attempt++) {
            const toolName = ROSTER[next() % ROSTER.length] as string;
            const args = randomArgs(next);
            const mapper = new SessionEventMapper({
                cwd: CWD,
                takeRecordedChanges: () => [],
                mcpToolIdentity: () => undefined,
            });

            let updates: SessionUpdate[] = [];
            expect(
                () => {
                    updates = mapper.map(
                        toolExecutionStart({ toolCallId: "call-1", toolName, args }),
                    );
                },
                `${toolName} with ${JSON.stringify(args)}`,
            ).not.toThrow();

            expect(updates).toHaveLength(1);
            expect(updates[0]?.sessionUpdate).toBe("tool_call");
        }
    });

    test.each(PATH_SHAPES)(
        "a read of %s is reported with a location Pico can stand behind",
        path => {
            const mapper = new SessionEventMapper({
                cwd: CWD,
                takeRecordedChanges: () => [],
                mcpToolIdentity: () => undefined,
            });

            const updates = mapper.map(
                toolExecutionStart({ toolCallId: "call-1", toolName: "read", args: { path } }),
            );

            expect(updates).toHaveLength(1);
            for (const location of locationsOf(updates[0])) {
                expect(location.path.startsWith("/")).toBe(true);
            }
        },
    );
});

function locationsOf(update: SessionUpdate | undefined): { path: string }[] {
    return update?.sessionUpdate === "tool_call" ? (update.locations ?? []) : [];
}
