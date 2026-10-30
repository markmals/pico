import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import { fakeMcpServer } from "./testing/mcp-fixture.ts";
import {
    createMockModel,
    EXCLUDED_TOOL_NAMES,
    mockAuthStorage,
    PICO_ROSTER,
    picoWorkspace,
} from "./testing/session-fixture.ts";

function sorted(names: readonly string[]): string[] {
    return [...names].sort();
}

/**
 * Tool names an MCP server may legitimately advertise, including the spellings
 * OMP rewrites when it mints `mcp__<server>_<tool>`: capitals, punctuation,
 * separators and names past the length cap. The `t<n>_` prefix keeps every
 * generated name distinct after rewriting.
 */
function generatedToolNames(seed: number, count: number): string[] {
    const alphabet = "abcXYZ019._- :";
    let state = seed;
    const next = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
    return Array.from({ length: count }, (_unused, index) => {
        let name = `t${index}_`;
        const length = 3 + Math.floor(next() * 70);
        for (let character = 0; character < length; character += 1) {
            name += alphabet[Math.floor(next() * alphabet.length)];
        }
        return name;
    });
}

describe("proposal.0001 effective roster", () => {
    test("a session without MCP servers has exactly Pico's built-in roster", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.deepEqual(sorted(session.engine.getActiveToolNames()), sorted(PICO_ROSTER));
    });

    test("the connected MCP server's tools join the roster", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("fake")],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.deepEqual(
            sorted(session.engine.getActiveToolNames()),
            sorted([...PICO_ROSTER, "mcp__fake_echo", "mcp__fake_launch_report"]),
        );
    });

    test("eval, lsp and task stay out even when the user's settings enable them", async t => {
        const { cwd, agentDir } = picoWorkspace(
            t,
            "eval:\n  py: true\n  js: true\nlsp:\n  enabled: true\ntask:\n  maxRecursionDepth: 5\n",
        );
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.deepEqual(sorted(session.engine.getActiveToolNames()), sorted(PICO_ROSTER));
    });

    test("for any MCP tool names, only Pico's roster and MCP tools are active", async t => {
        const advertised = generatedToolNames(0x5eed, 12);
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [
                fakeMcpServer("fake", { flags: advertised.flatMap(name => ["--tool", name]) }),
            ],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        const active = session.engine.getActiveToolNames();
        for (const name of active) {
            assert.ok(
                PICO_ROSTER.includes(name) || name.startsWith("mcp__"),
                `${name} is neither one of Pico's built-in tools nor an MCP tool`,
            );
        }
        for (const excluded of EXCLUDED_TOOL_NAMES) {
            assert.ok(!active.includes(excluded), `${excluded} must never be active`);
        }
        for (const builtin of PICO_ROSTER) {
            assert.ok(active.includes(builtin), `${builtin} is missing from the roster`);
        }
        assert.equal(active.filter(name => name.startsWith("mcp__")).length, advertised.length);
    });
});
