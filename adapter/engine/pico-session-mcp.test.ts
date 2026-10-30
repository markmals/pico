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
    captureStderr,
    createMockModel,
    mockAuthStorage,
    PICO_ROSTER,
    picoWorkspace,
    recordToolExecutions,
    systemPromptOf,
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
        assert.deepEqual(report, {
            args: ["--flavor", "alpha"],
            env: { PICO_FAKE_MCP_TOKEN: "launch-token" },
        });
    });

    test("stdio environment values reach the server exactly as the client sent them", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const env = {
            PICO_FAKE_COMMAND: "!echo injected",
            PICO_FAKE_HOST_VARIABLE: "HOME",
            PICO_FAKE_BLANK: "",
        };
        const model = createMockModel({
            responses: [{ content: [toolCall("mcp__fake_launch_report")] }, { content: ["done"] }],
        });
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("fake", { env })],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());

        const executions = recordToolExecutions(session.engine);
        await session.engine.prompt("report how you were launched");

        const report = JSON.parse(executions[0]?.text ?? "null") as { env: Record<string, string> };
        assert.deepEqual(report.env, env);
    });

    test("the server's instructions reach the model", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const instructions = "House rules from the fake server: PICO-MCP-INSTRUCTIONS.";
        const model = createMockModel({ responses: [{ content: ["ok"] }] });
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("fake", { flags: ["--instructions", instructions] })],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.ok(
            systemPromptOf(model).includes(instructions),
            "the model never received the server's instructions",
        );
    });

    test("a server slower than the discovery window still contributes its tools", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("slow", { flags: ["--delay-tools-list", "600"] })],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.ok(
            session.engine.getActiveToolNames().includes("mcp__slow_echo"),
            `the slow server's tools are missing: ${session.engine.getActiveToolNames().join(", ")}`,
        );
    });

    test("an inherited startup window never silently omits a slow server", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const previous = process.env.OMP_MCP_STARTUP_TIMEOUT_MS;
        process.env.OMP_MCP_STARTUP_TIMEOUT_MS = "100";
        t.after(() => {
            if (previous === undefined) delete process.env.OMP_MCP_STARTUP_TIMEOUT_MS;
            else process.env.OMP_MCP_STARTUP_TIMEOUT_MS = previous;
        });

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [fakeMcpServer("slow", { flags: ["--delay-tools-list", "600"] })],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /slow/);
                return true;
            },
        );
    });

    test("a server that dies before listing its tools fails creation, naming it", async t => {
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [fakeMcpServer("quitter", { flags: ["--exit-after-initialize"] })],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /quitter/);
                return true;
            },
        );
    });

    test("a server named __proto__ is connected like any other", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("__proto__")],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        const mcpTools = session.engine
            .getActiveToolNames()
            .filter(name => name.startsWith("mcp__"));
        assert.equal(
            mcpTools.length,
            2,
            `expected the server's two tools, got ${mcpTools.join(", ")}`,
        );
    });

    test("an MCP tool's server and tool name come from the connection, not from its minted name", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("my_server", { flags: ["--tool", "ping"] })],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.deepEqual(session.mcpToolIdentity("mcp__my_server_ping"), {
            server: "my_server",
            tool: "ping",
        });
        assert.equal(session.mcpToolIdentity("read"), undefined);
        assert.equal(session.mcpToolIdentity("mcp__other_thing"), undefined);
    });

    test("two servers sharing a name are rejected by name", async t => {
        const { cwd, agentDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [fakeMcpServer("twin"), fakeMcpServer("twin")],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /twin/);
                assert.match(error.message, /more than once|duplicate/i);
                return true;
            },
        );
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

describe("proposal.0001 MCP secrets", () => {
    const SECRET = "pico-secret-XYZ";

    test("a failed server's environment reaches neither the error nor the log", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const stderr = captureStderr(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                agentDir,
                mcpServers: [unstartableMcpServer("leaky", { SESH_MCP_TOKEN: SECRET })],
                authStorage: await mockAuthStorage(agentDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.ok(
                    !error.message.includes(SECRET),
                    `the error leaks the token: ${error.message}`,
                );
                return true;
            },
        );

        assert.ok(!stderr().includes(SECRET), "stderr leaks the token");
    });

    test("a connected server's environment never reaches the log", async t => {
        const { cwd, agentDir } = picoWorkspace(t);
        const stderr = captureStderr(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            mcpServers: [fakeMcpServer("fake", { env: { SESH_MCP_TOKEN: SECRET } })],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.ok(!stderr().includes(SECRET), "stderr leaks the token");
    });
});
