import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    EXCLUDED_TOOL_NAMES,
    mockAuthStorage,
    picoWorkspace,
    systemPromptOf,
    temporaryDirectory,
    toolCall,
} from "./testing/session-fixture.ts";

const AGENT_CONFIG = "ui:\n  theme: dark\n";

async function promptedSession(
    t: { after(cleanup: () => void | Promise<void>): void },
    agentConfig?: string,
) {
    const { cwd, agentDir } = picoWorkspace(t, agentConfig);
    const model = createMockModel({ responses: [{ content: ["ok"] }] });
    const session = await createPicoSession({
        cwd,
        agentDir,
        mcpServers: [],
        authStorage: await mockAuthStorage(agentDir),
        model,
    });
    t.after(() => session.dispose());
    await session.engine.prompt("hello");
    return { agentDir, cwd, prompt: systemPromptOf(model), session };
}

describe("proposal.0001 agent guidance", () => {
    test("the model is told where code intelligence, Sesh's tools and the worktree come from", async t => {
        const { prompt } = await promptedSession(t);
        const lines = prompt.split("\n");

        assert.ok(
            lines.some(line => line.includes("intellisense") && line.includes("bash")),
            "no line tells the model to run intellisense through bash",
        );
        assert.ok(prompt.includes("mcp__sesh_"), "the prompt never mentions Sesh's MCP tools");
        assert.ok(
            lines.some(line => /worktree/i.test(line) && line.includes("mcp__sesh_session_info")),
            "no line ties the Sesh worktree to mcp__sesh_session_info",
        );
    });

    test("the agent:// internal URL is gone while the rest of OMP's prompt stays", async t => {
        const { prompt } = await promptedSession(t);

        assert.ok(!prompt.includes("agent://"), "the subagent internal URL is still in the prompt");
        assert.ok(prompt.includes("# Internal URLs"), "the internal-URL list was dropped with it");
        assert.ok(prompt.includes("skill://"), "the surviving internal URLs were dropped with it");
        assert.ok(prompt.includes("# Engineering"), "OMP's default guidance was dropped");
    });

    test("Pico's prompt refers to no excluded tool", async t => {
        const { prompt } = await promptedSession(t);

        for (const excluded of EXCLUDED_TOOL_NAMES) {
            assert.ok(
                !prompt.includes(`\`${excluded}\``),
                `the prompt refers to the excluded tool ${excluded}`,
            );
        }
    });
});

describe("proposal.0001 the user's OMP configuration", () => {
    test("running a session rewrites no configuration and stores no session", async t => {
        const { agentDir } = await promptedSession(t, AGENT_CONFIG);

        assert.equal(fs.readFileSync(path.join(agentDir, "config.yml"), "utf8"), AGENT_CONFIG);
        assert.ok(!fs.existsSync(path.join(agentDir, "sessions")), "Pico created session files");
    });

    test("a turn that writes a file still rewrites no configuration", async t => {
        const { cwd, agentDir } = picoWorkspace(t, AGENT_CONFIG);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("write", { path: "note.txt", content: "hi\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("write note.txt");

        assert.equal(fs.readFileSync(path.join(agentDir, "config.yml"), "utf8"), AGENT_CONFIG);
        assert.ok(!fs.existsSync(path.join(agentDir, "sessions")), "Pico created session files");
    });
});

describe("proposal.0001 project context", () => {
    test("the worktree's AGENTS.md reaches the model and the main checkout's does not", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const mainCheckout = temporaryDirectory(t, "sesh-root");
        fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# House rules\n\nPICO-WORKTREE-MARKER\n");
        fs.writeFileSync(
            path.join(mainCheckout, "AGENTS.md"),
            "# House rules\n\nPICO-CHECKOUT-MARKER\n",
        );
        const previous = process.env.SESH_ROOT_PATH;
        process.env.SESH_ROOT_PATH = mainCheckout;
        t.after(() => {
            if (previous === undefined) delete process.env.SESH_ROOT_PATH;
            else process.env.SESH_ROOT_PATH = previous;
        });

        const model = createMockModel({ responses: [{ content: ["ok"] }] });
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        const received = JSON.stringify(model.calls[0]?.context);
        assert.ok(
            received.includes("PICO-WORKTREE-MARKER"),
            "the worktree's AGENTS.md never reached the model",
        );
        assert.ok(
            !received.includes("PICO-CHECKOUT-MARKER"),
            "the main checkout's AGENTS.md reached the model",
        );
    });
});
