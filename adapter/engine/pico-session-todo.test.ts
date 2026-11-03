import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    mockAuthStorage,
    picoWorkspace,
    recordToolExecutions,
    systemPromptOf,
    toolCall,
} from "./testing/session-fixture.ts";

const TODO_DISABLED = "todo:\n  enabled: false\n";

/**
 * Lets Oh My Pi title sessions for one test. A shell started by an Oh My Pi
 * session inherits `PI_NO_TITLE`, which hides every title request; CI has none.
 */
function allowTitles(t: { after(cleanup: () => void): void }): void {
    const suppressed = process.env.PI_NO_TITLE;
    delete process.env.PI_NO_TITLE;
    t.after(() => {
        if (suppressed !== undefined) process.env.PI_NO_TITLE = suppressed;
    });
}

describe("proposal.0006 todo settings", () => {
    test("todo is active even when the user's settings disable it, and their configuration is not rewritten", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t, TODO_DISABLED);
        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(dataDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.ok(session.engine.getActiveToolNames().includes("todo"));
        assert.equal(fs.readFileSync(path.join(agentDir, "config.yml"), "utf8"), TODO_DISABLED);
    });

    test("a turn that stops with open todo items ends without a reminder continuing it", async t => {
        allowTitles(t);
        const { cwd, dataDir } = picoWorkspace(t);
        const model = createMockModel({
            responses: [
                {
                    content: [
                        toolCall("todo", {
                            op: "init",
                            items: ["Write the test", "Write the code"],
                        }),
                    ],
                },
                { content: ["Stopping with work left."] },
            ],
            handler: { content: ["A reminder continued the turn."] },
        });
        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(dataDir),
            model,
        });
        t.after(() => session.dispose());
        const executions = recordToolExecutions(session.engine);

        await session.engine.prompt("plan the work, then stop");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [["todo", false]],
        );
        assert.deepEqual(
            session.engine.getTodoPhases().flatMap(phase => phase.tasks.map(task => task.status)),
            ["in_progress", "pending"],
        );
        assert.equal(model.calls.length, 2, "the turn continued after the model stopped");
    });

    test("creating a todo list starts no hidden title requests and leaves the session untitled", async t => {
        allowTitles(t);
        const { cwd, dataDir } = picoWorkspace(t);
        const model = createMockModel({
            responses: [
                { content: [toolCall("todo", { op: "init", items: ["Draft", "Review"] })] },
                { content: ["Planned."] },
            ],
            handler: { content: ["A hidden request used the model."] },
        });
        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(dataDir),
            model,
        });
        t.after(() => session.dispose());

        await session.engine.prompt("plan a draft and its review");

        assert.equal(model.calls.length, 2, "something besides the turn called the model");
        assert.equal(session.engine.sessionName, undefined);
    });

    test("the model is told to keep one flat todo list", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const model = createMockModel({ responses: [{ content: ["ok"] }] });
        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(dataDir),
            model,
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.match(systemPromptOf(model), /`todo` list flat[^\n]*`append` and `phase: "Tasks"`/);
    });
});
