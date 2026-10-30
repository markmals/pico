import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    editThenWrite,
    mockAuthStorage,
    picoWorkspace,
    recordToolExecutions,
    toolCall,
    writeToHashlineHeader,
} from "./testing/session-fixture.ts";

describe("proposal.0001 recorded writes", () => {
    test("a write to a new file records no old text and lands on disk", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall("write", { path: "fresh.txt", content: "hi\n" }, "write-1"),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("create fresh.txt");

        const absolute = path.join(cwd, "fresh.txt");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: null,
            newText: "hi\n",
        });
        assert.equal(fs.readFileSync(absolute, "utf8"), "hi\n");
        assert.equal(session.takeRecordedWrite("write-1"), undefined);
    });

    test("a write over an existing file records what was there before", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "existing.txt");
        fs.writeFileSync(absolute, "old\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall(
                                "write",
                                { path: "existing.txt", content: "new\n" },
                                "write-1",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("replace existing.txt");

        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: "old\n",
            newText: "new\n",
        });
        assert.equal(fs.readFileSync(absolute, "utf8"), "new\n");
    });

    test("two writes to one path in a turn each report their own text", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall("write", { path: "notes.txt", content: "one\n" }, "write-1"),
                            toolCall("write", { path: "notes.txt", content: "two\n" }, "write-2"),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("write notes.txt twice");

        const absolute = path.join(cwd, "notes.txt");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: null,
            newText: "one\n",
        });
        assert.deepEqual(session.takeRecordedWrite("write-2"), {
            path: absolute,
            oldText: "one\n",
            newText: "two\n",
        });
        assert.equal(session.takeRecordedWrite("write-1"), undefined);
    });

    test("a write over a CRLF file keeps CRLF on disk, and that is the text recorded", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "crlf.txt");
        fs.writeFileSync(absolute, "one\r\ntwo\r\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall(
                                "write",
                                { path: "crlf.txt", content: "one\nTWO\n" },
                                "write-1",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("replace crlf.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "one\r\nTWO\r\n");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: "one\r\ntwo\r\n",
            newText: "one\r\nTWO\r\n",
        });
    });

    test("a write over a file with a byte order mark keeps the mark", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "bom.txt");
        fs.writeFileSync(absolute, "\uFEFFhello\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall("write", { path: "bom.txt", content: "goodbye\n" }, "write-1"),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("replace bom.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "\uFEFFgoodbye\n");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: "\uFEFFhello\n",
            newText: "\uFEFFgoodbye\n",
        });
    });

    test("a write whose path is a pasted hashline header still records the file it wrote", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "pasted.txt");
        fs.writeFileSync(absolute, "before\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("read", { path: "pasted.txt" })] },
                    writeToHashlineHeader("pasted.txt", "after\n", "write-1"),
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("read then rewrite pasted.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "after\n");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: "before\n",
            newText: "after\n",
        });
    });

    test("an edit earlier in the same batch is what the write replaced", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "batch.txt");
        fs.writeFileSync(absolute, "one\ntwo\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("read", { path: "batch.txt" })] },
                    editThenWrite("batch.txt", "PUT 2.=2:\n+TWO", "final\n", "write-1"),
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("edit then overwrite batch.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "final\n");
        assert.deepEqual(session.takeRecordedWrite("write-1"), {
            path: absolute,
            oldText: "one\nTWO\n",
            newText: "final\n",
        });
    });

    test("a change made outside the session is what a later write replaced", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "drifting.txt");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall(
                                "write",
                                { path: "drifting.txt", content: "first\n" },
                                "write-1",
                            ),
                        ],
                    },
                    { content: ["done"] },
                    {
                        content: [
                            toolCall(
                                "write",
                                { path: "drifting.txt", content: "second\n" },
                                "write-2",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("create drifting.txt");
        fs.writeFileSync(absolute, "edited by hand\n");
        await session.engine.prompt("overwrite drifting.txt");

        assert.deepEqual(session.takeRecordedWrite("write-2"), {
            path: absolute,
            oldText: "edited by hand\n",
            newText: "second\n",
        });
    });

    test("a write to an internal URL records nothing and still runs", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall(
                                "write",
                                { path: "local://notes.md", content: "hi\n" },
                                "write-1",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("write a note");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [["write", false]],
        );
        assert.equal(session.takeRecordedWrite("write-1"), undefined);
    });
});
