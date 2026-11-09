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
    temporaryDirectory,
    toolCall,
} from "./testing/session-fixture.ts";

// hk runs this suite from `pre-push`, and git exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE
// to its hooks; git inheriting them would act on the outer repository. The fixture's git gets
// an environment without them, and the agent's command unsets them before its own git runs.
const fixtureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function git(cwd: string, ...args: string[]): void {
    const result = Bun.spawnSync(
        ["git", "-c", "user.name=Pico Test", "-c", "user.email=pico@example.com", ...args],
        { cwd, env: fixtureEnv, stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0)
        throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

describe("proposal.0010 OMP's worktree handling is off", () => {
    test("git worktree add through bash makes a plain git checkout", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        git(cwd, "init", "-q", "-b", "main");
        fs.writeFileSync(path.join(cwd, ".gitignore"), "build/\n");
        git(cwd, "add", ".gitignore");
        git(cwd, "commit", "-q", "-m", "init");
        fs.mkdirSync(path.join(cwd, "build"));
        fs.writeFileSync(path.join(cwd, "build", "artifact.txt"), "ignored\n");
        const worktree = path.join(temporaryDirectory(t, "worktrees"), "feature");

        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(dataDir),
            model: createMockModel({
                responses: [
                    {
                        content: [
                            toolCall("bash", {
                                command: `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE; git worktree add ${worktree}`,
                            }),
                        ],
                    },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("add a worktree");

        assert.equal(executions[0]?.isError, false, executions[0]?.text);
        assert.ok(fs.statSync(path.join(worktree, ".git")).isFile(), "git made no linked worktree");
        assert.ok(fs.existsSync(path.join(worktree, ".gitignore")));
        assert.ok(
            !fs.existsSync(path.join(worktree, "build", "artifact.txt")),
            "an ignored file was copied into the worktree, so OMP's clone ran instead of git",
        );
    });
});
