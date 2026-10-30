import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import {
    exited,
    fakeMcpServer,
    unstartableMcpServer,
    writeOmpMcpConfig,
} from "./testing/mcp-fixture.ts";
import {
    createMockModel,
    mockAuthStorage,
    PICO_ROSTER,
    picoWorkspace,
    recordToolExecutions,
    toolCall,
    useAsProcessAgentDir,
} from "./testing/session-fixture.ts";

describe("proposal.0001 host MCP servers", () => {
    test("a server is launched with its command, arguments and environment, and its tools run", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const model = createMockModel({
            responses: [{ content: [toolCall("mcp__fake_launch_report")] }, { content: ["done"] }],
        });
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [
                fakeMcpServer("fake", {
                    flags: ["--flavor", "alpha"],
                    env: { PICO_FAKE_MCP_TOKEN: "launch-token" },
                }),
            ],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("report how you were launched");

        assert.deepEqual(
            executions.map(execution => execution.name),
            ["mcp__fake_launch_report"],
        );
        assert.equal(executions[0]?.isError, false);
        const report: unknown = JSON.parse(executions[0]?.text ?? "null");
        assert.deepEqual(report, { args: ["--flavor", "alpha"], token: "launch-token" });
    });

    test("a server that cannot start fails creation, naming the server and the cause", async t => {
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [unstartableMcpServer("unstartable")],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /unstartable/);
                assert.match(error.message, /no such file or directory/i);
                return true;
            },
        );
    });

    test("a server that cannot list its tools fails creation, naming the server and the cause", async t => {
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [fakeMcpServer("listless", { flags: ["--fail-tools-list"] })],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /listless/);
                assert.match(error.message, /refuses to list tools/);
                return true;
            },
        );
    });

    test("a failing server terminates the servers that already started", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "healthy.pid");

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [
                    fakeMcpServer("healthy", { flags: ["--pid-file", pidFile] }),
                    fakeMcpServer("listless", { flags: ["--fail-tools-list"] }),
                ],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            PicoSessionError,
        );

        assert.ok(
            fs.existsSync(pidFile),
            "the healthy server never started, so nothing was left to terminate",
        );
        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        assert.ok(await exited(pid), `the healthy server (pid ${pid}) outlived the failed session`);
    });

    test("dispose terminates the spawned servers and repeats harmlessly", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "fake.pid");
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("fake", { flags: ["--pid-file", pidFile] })],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });

        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        await session.dispose();
        assert.ok(await exited(pid), `the MCP server (pid ${pid}) survived dispose`);
        await session.dispose();
    });

    test("MCP servers in the user's own OMP configuration are never connected", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const projectPid = path.join(cwd, "project.pid");
        const userPid = path.join(cwd, "user.pid");
        writeOmpMcpConfig(
            path.join(cwd, ".omp", "mcp.json"),
            fakeMcpServer("projectserver", { flags: ["--pid-file", projectPid] }),
        );
        writeOmpMcpConfig(
            path.join(agentDir, "mcp.json"),
            fakeMcpServer("userserver", { flags: ["--pid-file", userPid] }),
        );
        useAsProcessAgentDir(t, agentDir);

        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.deepEqual([...session.engine.getActiveToolNames()].sort(), [...PICO_ROSTER].sort());
        assert.ok(!fs.existsSync(projectPid), "the project's own MCP server was spawned");
        assert.ok(!fs.existsSync(userPid), "the user's own MCP server was spawned");
    });
});
