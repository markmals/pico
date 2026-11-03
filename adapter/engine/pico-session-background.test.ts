import { cfgBashAutoBackgroundThresholdMs } from "@oh-my-pi/pi-coding-agent/exec/settings";
import { cfgAsyncMaxJobs, cfgLaunchEnabled } from "@oh-my-pi/pi-coding-agent/tools/settings";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PicoSession } from "./pico-session.ts";
import type { Cleanups, ToolExecution } from "./testing/session-fixture.ts";

import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    mockAuthStorage,
    picoWorkspace,
    recordToolExecutions,
    systemPromptOf,
    toolCall,
} from "./testing/session-fixture.ts";

/** Whether a process id still names a live process. */
function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * A background job whose process ignores SIGTERM, as a server that traps it would. It publishes
 * its process id first, so the test can watch the process OMP's first signal leaves running.
 */
function stubbornJob(pidFile: string, id: string) {
    return toolCall(
        "bash",
        {
            command: `/bin/sh -c 'trap "" TERM; echo $$ > ${pidFile}; exec /bin/sleep 30'`,
            async: true,
        },
        id,
    );
}

async function backgroundSession(
    t: Cleanups,
    responses: Parameters<typeof createMockModel>[0],
    options: { autoBackground?: boolean } = {},
): Promise<{ session: PicoSession; cwd: string; executions: ToolExecution[] }> {
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    const session = await createPicoSession({
        cwd,
        agentDir,
        dataDir,
        mcpServers: [],
        authStorage: await mockAuthStorage(agentDir),
        model: createMockModel(responses),
        ...options,
    });
    t.after(() => session.dispose());
    return { session, cwd, executions: recordToolExecutions(session.engine) };
}

/** Polls the operating system, which announces nothing when a pid file appears. */
async function pidFrom(file: string): Promise<number> {
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() === "") {
        if (Date.now() > deadline) throw new Error(`${file} never appeared`);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 25);
        await promise;
    }
    return Number(fs.readFileSync(file, "utf8").trim());
}

describe("proposal.0008 roster and settings", () => {
    test("bash offers async but not service mode, and wait is active", async t => {
        const model = createMockModel({ responses: [{ content: ["ok"] }] });
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());
        await session.engine.prompt("hello");

        const tools = model.calls[0]?.context.tools ?? [];
        const bash = tools.find(tool => tool.name === "bash");
        const schema = bash?.parameters;
        const properties =
            schema && typeof schema === "object" && "properties" in schema ? schema.properties : {};
        const parameters = Object.keys(properties ?? {});
        assert.ok(parameters.includes("async"), `bash parameters: ${parameters.join(", ")}`);
        assert.ok(!parameters.includes("name"), "bash offers service mode's name");
        assert.ok(!parameters.includes("ready"), "bash offers service mode's ready");
        assert.ok(tools.some(tool => tool.name === "wait"));
    });

    test("the job limit and the auto-background threshold are Pico's, and services are off", async t => {
        const { session } = await backgroundSession(t, { responses: [{ content: ["ok"] }] });

        assert.equal(cfgLaunchEnabled.get(session.engine.settings), false);
        assert.equal(cfgAsyncMaxJobs.get(session.engine.settings), 100);
        assert.equal(cfgBashAutoBackgroundThresholdMs.get(session.engine.settings), 60_000);
    });

    // OMP moves a command to the background 1 s before its own timeout when that comes
    // before the threshold, which lets a test see auto-background without waiting a minute.
    const slowCommand = toolCall(
        "bash",
        { command: "/bin/sleep 3; echo slow", timeout: 2 },
        "slow",
    );

    test("with auto-background on, a slow plain command moves to the background", async t => {
        const { session, executions } = await backgroundSession(t, {
            responses: [{ content: [slowCommand] }, { content: ["started"] }],
            handler: { content: ["woken"] },
        });

        await session.engine.prompt("run something slow");

        assert.match(executions[0]?.text ?? "", /Backgrounded as job bg_1/);
    });

    test("with auto-background off, a slow plain command stays in the foreground", async t => {
        const { session, executions } = await backgroundSession(
            t,
            { responses: [{ content: [slowCommand] }, { content: ["timed out"] }] },
            { autoBackground: false },
        );

        await session.engine.prompt("run something slow");

        assert.equal(executions[0]?.isError, true);
        assert.match(executions[0]?.text ?? "", /timed out/i);
    });
});

describe("proposal.0008 stopping background jobs", () => {
    test("stopping returns only once a job's process that ignores SIGTERM has exited", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "job.pid");
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [{ content: [stubbornJob(pidFile, "job")] }, { content: ["started"] }],
            }),
        });
        t.after(() => session.dispose());
        await session.engine.prompt("start a job");
        const pid = await pidFrom(pidFile);

        assert.equal(await session.stopBackgroundJobs(), true);
        assert.equal(isRunning(pid), false);
    });

    test("disposing a session returns only once a job's process that ignores SIGTERM has exited", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "job.pid");
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [{ content: [stubbornJob(pidFile, "job")] }, { content: ["started"] }],
            }),
        });
        await session.engine.prompt("start a job");
        const pid = await pidFrom(pidFile);

        await session.dispose();

        assert.equal(isRunning(pid), false);
    });
});

describe("proposal.0008 guidance", () => {
    test("the model is told that background jobs belong to the turn", async t => {
        const model = createMockModel({ responses: [{ content: ["ok"] }] });
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model,
        });
        t.after(() => session.dispose());
        await session.engine.prompt("hello");

        assert.match(
            systemPromptOf(model),
            /background `bash` job belongs to the turn that started it[^\n]*stopping the turn kills them/,
        );
    });
});
