import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { RecordedChange } from "./pico-session.ts";

import { createPicoSession } from "./pico-session.ts";
import { installDetailStrippingExtension } from "./testing/extension-fixture.ts";
import {
    collectToolCallIds,
    collectWrites,
    createMockModel,
    editAfterRead,
    mockAuthStorage,
    picoWorkspace,
    recordToolExecutions,
    toolCall,
    writeToHashlineHeader,
} from "./testing/session-fixture.ts";

interface Written {
    file: string;
    content: string;
    id?: string;
}

/** A session whose scripted turn performs `writes`, in one assistant message. */
async function writingSession(
    t: { after(cleanup: () => void | Promise<void>): void },
    writes: readonly Written[],
) {
    const { cwd, agentDir } = picoWorkspace(t);
    const session = await createPicoSession({
        cwd,
        agentDir,
        mcpServers: [],
        authStorage: await mockAuthStorage(agentDir),
        model: createMockModel({
            responses: [
                {
                    content: writes.map(write =>
                        toolCall("write", { path: write.file, content: write.content }, write.id),
                    ),
                },
                { content: ["done"] },
            ],
        }),
    });
    t.after(() => session.dispose());
    return { cwd, session, written: collectWrites(session) };
}

describe("proposal.0001 recorded writes", () => {
    test("a write to a new file records no old text and lands on disk", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "fresh.txt", content: "hi\n" },
        ]);

        await session.engine.prompt("create fresh.txt");

        const absolute = path.join(cwd, "fresh.txt");
        assert.deepEqual(written, [{ path: absolute, oldText: null, newText: "hi\n" }]);
        assert.equal(fs.readFileSync(absolute, "utf8"), "hi\n");
    });

    test("a write over an existing file records exactly what it replaced", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "existing.txt", content: "new\n" },
        ]);
        const absolute = path.join(cwd, "existing.txt");
        fs.writeFileSync(absolute, "old\n");

        await session.engine.prompt("replace existing.txt");

        assert.deepEqual(written, [{ path: absolute, oldText: "old\n", newText: "new\n" }]);
        assert.equal(fs.readFileSync(absolute, "utf8"), "new\n");
    });

    test("two writes to one path in a turn are taken in order", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "notes.txt", content: "one\n" },
            { file: "notes.txt", content: "two\n" },
        ]);

        await session.engine.prompt("write notes.txt twice");

        const absolute = path.join(cwd, "notes.txt");
        assert.deepEqual(written, [
            { path: absolute, oldText: null, newText: "one\n" },
            { path: absolute, oldText: "one\n", newText: "two\n" },
        ]);
    });

    test("a write over a CRLF file keeps CRLF on disk, and that is the text recorded", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "crlf.txt", content: "one\nTWO\n" },
        ]);
        const absolute = path.join(cwd, "crlf.txt");
        fs.writeFileSync(absolute, "one\r\ntwo\r\n");

        await session.engine.prompt("replace crlf.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "one\r\nTWO\r\n");
        assert.deepEqual(written, [
            { path: absolute, oldText: "one\r\ntwo\r\n", newText: "one\r\nTWO\r\n" },
        ]);
    });

    test("a write over a file with a byte order mark keeps the mark", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "bom.txt", content: "goodbye\n" },
        ]);
        const absolute = path.join(cwd, "bom.txt");
        fs.writeFileSync(absolute, "\uFEFFhello\n");

        await session.engine.prompt("replace bom.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "\uFEFFgoodbye\n");
        assert.deepEqual(written, [
            { path: absolute, oldText: "\uFEFFhello\n", newText: "\uFEFFgoodbye\n" },
        ]);
    });

    test("a write whose path is a pasted hashline header records the file it wrote", async t => {
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
        const written = collectWrites(session);

        await session.engine.prompt("read then rewrite pasted.txt");

        assert.deepEqual(written, [{ path: absolute, oldText: "before\n", newText: "after\n" }]);
    });

    test("a write through a symlink records the path the engine wrote and changes the target", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "alias.txt", content: "after\n" },
        ]);
        const target = path.join(cwd, "target.txt");
        const alias = path.join(cwd, "alias.txt");
        fs.writeFileSync(target, "before\n");
        fs.symlinkSync("target.txt", alias);

        await session.engine.prompt("write through the link");

        assert.equal(fs.readFileSync(target, "utf8"), "after\n");
        assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
        assert.deepEqual(written, [{ path: alias, oldText: "before\n", newText: "after\n" }]);
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
                    { content: [toolCall("write", { path: "local://notes.md", content: "hi\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());
        const written = collectWrites(session);

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("write a note");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [["write", false]],
        );
        assert.deepEqual(written, []);
    });

    test("a record nothing took during the turn is gone once the turn ends", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("write", { path: "unclaimed.txt", content: "hi\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());
        const ids = collectToolCallIds(session.engine);

        await session.engine.prompt("create unclaimed.txt");

        assert.equal(fs.readFileSync(path.join(cwd, "unclaimed.txt"), "utf8"), "hi\n");
        assert.equal(ids.length, 1);
        assert.deepEqual(session.takeChanges(ids[0] ?? ""), []);
    });
});

describe("proposal.0001 undiffable files", () => {
    test("a write over a binary file reports no diff and says why", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "image.bin", content: "text\n" },
        ]);
        const absolute = path.join(cwd, "image.bin");
        fs.writeFileSync(absolute, Buffer.concat([Buffer.alloc(8192, 65), Buffer.from([0, 128])]));

        await session.engine.prompt("replace image.bin");

        assert.deepEqual(written, [{ path: absolute, noDiff: "it is a binary file" }]);
    });

    test("a write over a file larger than a mebibyte reports no diff and says why", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "huge.txt", content: "small\n" },
        ]);
        const absolute = path.join(cwd, "huge.txt");
        fs.writeFileSync(absolute, "x".repeat(1024 * 1024 + 1));

        await session.engine.prompt("replace huge.txt");

        assert.deepEqual(written, [{ path: absolute, noDiff: "it is larger than 1 MiB" }]);
    });

    test("a file larger than a mebibyte still lends the write its BOM and line endings", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "huge-crlf.txt", content: "after\n" },
        ]);
        const absolute = path.join(cwd, "huge-crlf.txt");
        fs.writeFileSync(absolute, `\uFEFF${"x\r\n".repeat(400_000)}`);

        await session.engine.prompt("replace huge-crlf.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "\uFEFFafter\r\n");
        assert.deepEqual(written, [{ path: absolute, noDiff: "it is larger than 1 MiB" }]);
    });

    test("a file that is not valid UTF-8 reports no diff and says why", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "latin.bin", content: "text\n" },
        ]);
        const absolute = path.join(cwd, "latin.bin");
        fs.writeFileSync(absolute, Buffer.from([0xff, 0xfe, 0x41]));

        await session.engine.prompt("replace latin.bin");

        assert.deepEqual(written, [{ path: absolute, noDiff: "it is a binary file" }]);
    });

    test("a write over a file Pico cannot read reports why, and still runs", async t => {
        const { cwd, session, written } = await writingSession(t, [
            { file: "unreadable.txt", content: "replaced\n" },
        ]);
        const absolute = path.join(cwd, "unreadable.txt");
        fs.writeFileSync(absolute, "secret\n");
        fs.chmodSync(absolute, 0o200);

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("replace unreadable.txt");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [["write", false]],
        );
        const [record] = written;
        assert.equal(record?.path, absolute);
        assert.ok(
            record && "noDiff" in record,
            `expected a no-diff record, got ${JSON.stringify(record)}`,
        );
        assert.match(record.noDiff, /could not read it/);
        assert.match(record.noDiff, /EACCES/);
    });
});

describe("proposal.0001 change attribution", () => {
    test("an edit's record is attributed to the edit's tool call", async t => {
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
        const byCall = new Map<string, RecordedChange[]>();
        session.engine.subscribe(event => {
            if (event.type !== "tool_execution_end") return;
            byCall.set(event.toolCallId, session.takeChanges(event.toolCallId));
        });

        await session.engine.prompt("edit edited.txt");

        assert.equal(fs.readFileSync(absolute, "utf8"), "one\nTWO\n");
        assert.deepEqual(byCall.get("edit-1"), [
            { path: absolute, oldText: "one\ntwo\n", newText: "one\nTWO\n" },
        ]);
    });

    test("an extension that rewrites a write's details does not strand its record", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const absolute = path.join(cwd, "detailed.txt");
        installDetailStrippingExtension(path.join(cwd, ".omp", "extensions"));
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
                                { path: "detailed.txt", content: "one\n" },
                                "write-1",
                            ),
                            toolCall(
                                "write",
                                { path: "detailed.txt", content: "two\n" },
                                "write-2",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());
        const byCall = new Map<string, RecordedChange[]>();
        session.engine.subscribe(event => {
            if (event.type !== "tool_execution_end") return;
            byCall.set(event.toolCallId, session.takeChanges(event.toolCallId));
        });

        await session.engine.prompt("write detailed.txt twice");

        assert.deepEqual(byCall.get("write-1"), [
            { path: absolute, oldText: null, newText: "one\n" },
        ]);
        assert.deepEqual(byCall.get("write-2"), [
            { path: absolute, oldText: "one\n", newText: "two\n" },
        ]);
    });
});
