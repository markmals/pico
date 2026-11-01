import type { SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fakeMcpServer } from "../engine/testing/mcp-fixture.ts";
import { removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";
import { closeOpenConnections, startPicoSession } from "./session-fixture.ts";

const LAUNCH_SCHEMA = {
    type: "object",
    properties: {
        project: { type: "string" },
        prompt: { type: "string" },
        agent: { type: "string" },
        inPlace: { type: "boolean" },
    },
    required: ["project", "prompt"],
    additionalProperties: false,
};

function host(cwd: string, schema: unknown = LAUNCH_SCHEMA, server = "sesh") {
    return fakeMcpServer(server, {
        flags: [
            "--tool",
            "start_session",
            "--input-schema",
            JSON.stringify(schema),
            "--calls-file",
            join(cwd, `${server}-calls.jsonl`),
        ],
    });
}

function receivedCalls(cwd: string, server = "sesh"): Array<{ name: string; arguments: unknown }> {
    const file = join(cwd, `${server}-calls.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map(line => {
            const { name, arguments: args } = JSON.parse(line);
            return { name, arguments: args };
        });
}

function completedCalls(updates: SessionUpdate[]): Map<string, ToolCallUpdate> {
    return new Map(
        updates.flatMap(update =>
            update.sessionUpdate === "tool_call_update" &&
            (update.status === "completed" || update.status === "failed")
                ? [[update.toolCallId, update] as const]
                : [],
        ),
    );
}

function textOf(update: ToolCallUpdate | undefined): string {
    return (update?.content ?? [])
        .flatMap(content =>
            content.type === "content" && content.content.type === "text"
                ? [content.content.text]
                : [],
        )
        .join("\n");
}

function generatedSelections(seed: number, count: number): unknown[] {
    let state = seed;
    const next = (bound: number) => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) % bound;
    };
    const value = (depth: number): unknown => {
        switch (next(depth > 0 ? 6 : 4)) {
            case 0:
                return null;
            case 1:
                return next(2) === 0;
            case 2:
                return next(2001) - 1000;
            case 3:
                return Array.from({ length: next(24) }, () =>
                    String.fromCodePoint(32 + next(96)),
                ).join("");
            case 4:
                return Array.from({ length: next(5) }, () => value(depth - 1));
            default:
                return { [`key-${next(1000)}`]: value(depth - 1) };
        }
    };
    return Array.from({ length: count }, () => value(3));
}

afterEach(closeOpenConnections);
afterAll(removeTemporaryDirectories);

describe("proposal.0003 Pico-only child sessions", () => {
    test("any supplied agent selection fails before a host launch, with an omitted-agent control", async () => {
        const cwd = temporaryProject();
        const selections = [
            "codex",
            "claude",
            "oh-my-pi",
            "pico",
            "pico-preview",
            "",
            null,
            ...generatedSelections(0x5eed, 64),
        ];
        const session = await startPicoSession(
            [
                {
                    content: selections.map((agent, index) => ({
                        type: "toolCall" as const,
                        id: `override-${index}`,
                        name: "mcp__sesh_start_session",
                        arguments: { project: cwd, prompt: "review", agent },
                    })),
                },
                {
                    content: [
                        {
                            type: "toolCall",
                            id: "control",
                            name: "mcp__sesh_start_session",
                            arguments: { project: cwd, prompt: "review" },
                        },
                    ],
                },
                { content: ["done"] },
            ],
            { cwd, mcpServers: [host(cwd)] },
        );

        await session.prompt("exercise the launch boundary");

        const ended = completedCalls(session.updates());
        for (let index = 0; index < selections.length; index++) {
            const rejected = ended.get(`override-${index}`);
            expect(rejected?.status, `selection ${JSON.stringify(selections[index])}`).toBe(
                "failed",
            );
            expect(textOf(rejected)).toMatch(/inherit.*agent|agent.*inherit/i);
        }
        expect(ended.get("control")?.status).toBe("completed");
        expect(receivedCalls(cwd)).toEqual([
            { name: "start_session", arguments: { project: cwd, prompt: "review" } },
        ]);
        const opened = session.updates().filter(update => update.sessionUpdate === "tool_call");
        expect(
            opened.every(
                call =>
                    call.name === "mcp__sesh_start_session" && call.title === "sesh: start_session",
            ),
        ).toBe(true);
        expect(session.client.permissionRequests).toEqual([]);
    }, 30_000);

    test("the model cannot select an agent through the advertised launch schema", async () => {
        const cwd = temporaryProject();
        const session = await startPicoSession([{ content: ["ready"] }], {
            cwd,
            mcpServers: [host(cwd)],
        });

        await session.prompt("show the available tools");

        const launch = session.model.calls[0]?.context.tools?.find(
            tool => tool.name === "mcp__sesh_start_session",
        );
        expect(launch?.parameters).not.toHaveProperty("properties.agent");
        expect(launch?.parameters).toHaveProperty(
            "required",
            expect.arrayContaining(["project", "prompt"]),
        );
        expect(launch?.parameters).not.toHaveProperty(
            "required",
            expect.arrayContaining(["agent"]),
        );
        expect(launch?.parameters).toHaveProperty("properties.inPlace");
    });

    for (const [keyword, constraint] of Object.entries({
        anyOf: [{ required: ["agent"] }, {}],
        oneOf: [{ required: ["agent"] }, { required: ["project"] }],
        allOf: [{ required: ["agent"] }],
        required: ["project", "prompt", "agent"],
        minProperties: 4,
        const: { project: "project", prompt: "review", agent: "codex" },
        enum: [{ project: "project", prompt: "review", agent: "codex" }],
        dependentRequired: { project: ["agent"] },
        if: { required: ["agent"] },
        $ref: "#/$defs/launch",
    })) {
        test(`an incompatible ${keyword} launch schema fails session creation`, async () => {
            const cwd = temporaryProject();
            const schema = {
                ...LAUNCH_SCHEMA,
                [keyword]: constraint,
                $defs: { launch: LAUNCH_SCHEMA },
            };

            await expect(
                startPicoSession([{ content: ["unused"] }], {
                    cwd,
                    mcpServers: [host(cwd, schema)],
                }),
            ).rejects.toThrow(/sesh.*start_session|start_session.*sesh/i);
            expect(receivedCalls(cwd)).toEqual([]);
        });
    }

    test("another server's start_session is not mistaken for Sesh's launch operation", async () => {
        const cwd = temporaryProject();
        const session = await startPicoSession(
            [
                {
                    content: [
                        {
                            type: "toolCall",
                            name: "mcp__other_start_session",
                            arguments: { project: cwd, prompt: "review", agent: "codex" },
                        },
                    ],
                },
                { content: ["done"] },
            ],
            { cwd, mcpServers: [host(cwd, LAUNCH_SCHEMA, "other")] },
        );

        await session.prompt("use the other server");

        expect([...completedCalls(session.updates()).values()].map(call => call.status)).toEqual([
            "completed",
        ]);
        expect(receivedCalls(cwd, "other")).toEqual([
            {
                name: "start_session",
                arguments: { project: cwd, prompt: "review", agent: "codex" },
            },
        ]);
    });
});
