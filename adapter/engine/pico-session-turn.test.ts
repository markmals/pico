import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    editAfterRead,
    mockAuthStorage,
    picoWorkspace,
    recordToolExecutions,
    temporaryDirectory,
    toolCall,
} from "./testing/session-fixture.ts";

describe("proposal.0001 approvals", () => {
    test("bash and edit run to completion even when the user's settings ask for approval", async t => {
        const { cwd, agentDir } = picoWorkspace(t, "tools:\n  approvalMode: always-ask\n");
        const target = path.join(cwd, "b.txt");
        fs.writeFileSync(target, "one\ntwo\n");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("bash", { command: "echo pico-ran" })] },
                    { content: [toolCall("read", { path: "b.txt" })] },
                    editAfterRead("b.txt", "PUT 2.=2:\n+TWO"),
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("run a command, then edit b.txt");

        assert.deepEqual(
            executions.map(execution => execution.name),
            ["bash", "read", "edit"],
        );
        assert.deepEqual(
            executions.map(execution => execution.isError),
            [false, false, false],
        );
        assert.match(executions[0]?.text ?? "", /pico-ran/);
        assert.equal(fs.readFileSync(target, "utf8"), "one\nTWO\n");
    });

    test("per-tool policies and restricted folders do not stop a tool call either", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        fs.writeFileSync(
            path.join(agentDir, "config.yml"),
            `tools:\n  approvalMode: always-ask\n  approval:\n    bash: deny\n    write: prompt\n  restrictedFolders:\n    - ${cwd}\n`,
        );
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("bash", { command: "echo pico-ran" })] },
                    { content: [toolCall("write", { path: "denied.txt", content: "written\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("run a command, then write a file");

        assert.deepEqual(
            executions.map(execution => [execution.name, execution.isError]),
            [
                ["bash", false],
                ["write", false],
            ],
        );
        assert.equal(fs.readFileSync(path.join(cwd, "denied.txt"), "utf8"), "written\n");
    });
});

describe("proposal.0001 working directory", () => {
    test("files land in the session's cwd while SESH_ROOT_PATH points elsewhere", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const mainCheckout = temporaryDirectory(t, "sesh-root");
        const previous = process.env.SESH_ROOT_PATH;
        process.env.SESH_ROOT_PATH = mainCheckout;
        t.after(() => {
            if (previous === undefined) delete process.env.SESH_ROOT_PATH;
            else process.env.SESH_ROOT_PATH = previous;
        });

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
                                { path: "worktree.txt", content: "branch\n" },
                                "write-1",
                            ),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("create worktree.txt");

        assert.equal(session.cwd, cwd);
        assert.deepEqual(session.takeRecordedChanges("write-1"), [
            {
                path: path.join(cwd, "worktree.txt"),
                oldText: null,
                newText: "branch\n",
            },
        ]);
        assert.equal(fs.readFileSync(path.join(cwd, "worktree.txt"), "utf8"), "branch\n");
        assert.deepEqual(fs.readdirSync(mainCheckout), []);
    });
});
