import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    editAfterRead,
    editFiles,
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: null,
                newText: "hi\n",
            },
        ]);
        assert.equal(fs.readFileSync(absolute, "utf8"), "hi\n");
        assert.deepEqual(session.takeRecordedChanges("write-1"), []);
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

        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: "old\n",
                newText: "new\n",
            },
        ]);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: null,
                newText: "one\n",
            },
        ]);
        assert.deepEqual(session.takeRecordedChanges("write-2"), [
            {
                path: absolute,
                oldText: "one\n",
                newText: "two\n",
            },
        ]);
        assert.deepEqual(session.takeRecordedChanges("write-1"), []);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: "one\r\ntwo\r\n",
                newText: "one\r\nTWO\r\n",
            },
        ]);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: "\uFEFFhello\n",
                newText: "\uFEFFgoodbye\n",
            },
        ]);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: "before\n",
                newText: "after\n",
            },
        ]);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: absolute,
                oldText: "one\nTWO\n",
                newText: "final\n",
            },
        ]);
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

        assert.deepEqual(session.takeRecordedChanges("write-2"), [
            {
                path: absolute,
                oldText: "edited by hand\n",
                newText: "second\n",
            },
        ]);
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
        assert.deepEqual(session.takeRecordedChanges("write-1"), []);
    });

    test("an edit records every file it changed", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "edited.txt");
        fs.writeFileSync(absolute, "one\ntwo\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("read", { path: "edited.txt" })] },
                    editAfterRead("edited.txt", "PUT 2.=2:\n+TWO", "edit-1"),
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("edit edited.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "one\nTWO\n");
        assert.deepEqual(session.takeRecordedChanges("edit-1"), [
            { path: absolute, oldText: "one\ntwo\n", newText: "one\nTWO\n" },
        ]);
        assert.deepEqual(session.takeRecordedChanges("edit-1"), []);
    });

    test("an edit that deletes one file and changes another records both", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const removed = path.join(cwd, "gone.txt");
        const kept = path.join(cwd, "kept.txt");
        fs.writeFileSync(removed, "delete me\n");
        fs.writeFileSync(kept, "one\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("read", { path: "gone.txt" })] },
                    { content: [toolCall("read", { path: "kept.txt" })] },
                    editFiles(
                        [
                            { file: "gone.txt", body: "REM" },
                            { file: "kept.txt", body: "PUT 1.=1:\n+ONE" },
                        ],
                        "edit-1",
                    ),
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("delete gone.txt and change kept.txt");

        assert.equal(fs.existsSync(removed), false);
        assert.equal(fs.readFileSync(kept, "utf8"), "ONE\n");
        assert.deepEqual(session.takeRecordedChanges("edit-1"), [
            { path: removed, oldText: "delete me\n", newText: "" },
            { path: kept, oldText: "one\n", newText: "ONE\n" },
        ]);
    });

    test("a file the recorder cannot read is reported without a diff, and the write still runs", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "unreadable.txt");
        fs.writeFileSync(absolute, "secret\n");
        fs.chmodSync(absolute, 0o200);
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
                                { path: "unreadable.txt", content: "replaced\n" },
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
        await session.engine.prompt("replace unreadable.txt");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [["write", false]],
        );
        const records = session.takeRecordedChanges("write-1");
        assert.equal(records.length, 1);
        const [record] = records;
        assert.ok(
            record && "noDiff" in record,
            `expected a no-diff record, got ${JSON.stringify(records)}`,
        );
        assert.equal(record.path, absolute);
        assert.match(record.noDiff, /could not read it/);
        assert.match(record.noDiff, /EACCES/);
    });
});

describe("proposal.0001 undiffable files", () => {
    test("a write over a binary file reports no diff and says why", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "image.bin");
        fs.writeFileSync(absolute, Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]));
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall("write", { path: "image.bin", content: "text\n" }, "write-1"),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("replace image.bin");

        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            { path: absolute, noDiff: "it is a binary file" },
        ]);
    });

    test("a write through a symlink replaces what the earlier write in the batch left", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "target.txt");
        const alias = path.join(cwd, "alias.txt");
        fs.writeFileSync(absolute, "before\n");
        fs.symlinkSync(absolute, alias);
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
                                { path: "target.txt", content: "intermediate\n" },
                                "write-1",
                            ),
                            toolCall("write", { path: "alias.txt", content: "final\n" }, "write-2"),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("write the file and then its link");

        assert.deepEqual(session.takeRecordedChanges("write-2"), [
            { path: alias, oldText: "intermediate\n", newText: "final\n" },
        ]);
    });
});
