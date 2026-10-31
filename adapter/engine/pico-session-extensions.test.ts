import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import {
    installCountingExtension,
    installExitingExtension,
    installRecordingExtension,
    installThrowingFactoryExtension,
    installWriteRedirectingExtension,
    recordedExtensionEvents,
} from "./testing/extension-fixture.ts";
import {
    captureStderr,
    collectWrites,
    createMockModel,
    mockAuthStorage,
    PICO_ROSTER,
    picoWorkspace,
    toolCall,
    useAsProcessAgentDir,
} from "./testing/session-fixture.ts";

describe("proposal.0001 extension hooks", () => {
    test("a project extension's hooks run across a turn", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const log = path.join(cwd, "project-extension.log");
        installRecordingExtension(path.join(cwd, ".omp", "extensions"), log);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("write", { path: "a.txt", content: "hi\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("write a.txt");

        const events = recordedExtensionEvents(log);
        for (const expected of [
            "agent_start",
            "turn_start",
            "tool_call write",
            "tool_execution_start",
            "tool_result write",
            "tool_execution_end",
            "turn_end",
            "agent_end",
        ]) {
            assert.ok(
                events.includes(expected),
                `the extension never saw ${expected}; it saw ${events.join(", ")}`,
            );
        }
    });

    test("a user extension in the agent directory runs too", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const log = path.join(cwd, "user-extension.log");
        installRecordingExtension(path.join(agentDir, "extensions"), log);
        useAsProcessAgentDir(t, agentDir);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.ok(
            recordedExtensionEvents(log).includes("agent_start"),
            "the user extension's hooks never ran",
        );
    });

    test("an extension's own tool never joins the roster", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const log = path.join(cwd, "tool-extension.log");
        installRecordingExtension(path.join(cwd, ".omp", "extensions"), log);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.deepEqual([...session.engine.getActiveToolNames()].sort(), [...PICO_ROSTER].sort());
        assert.ok(
            recordedExtensionEvents(log).includes("agent_start"),
            "the extension was not loaded at all",
        );
    });

    test("an extension that exits while loading is skipped and reported, and Pico survives", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const extensionsDirectory = path.join(cwd, ".omp", "extensions");
        const log = path.join(cwd, "surviving-extension.log");
        const hostile = installExitingExtension(extensionsDirectory);
        installRecordingExtension(extensionsDirectory, log);
        const stderr = captureStderr(t);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        assert.ok(
            stderr().includes(hostile),
            `stderr does not name the failed extension: ${stderr()}`,
        );
        assert.ok(
            recordedExtensionEvents(log).includes("agent_start"),
            "the surviving extension's hooks never ran",
        );
    });
});

describe("proposal.0001 extension loading", () => {
    test("a discovered extension's module and factory each run once", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const log = path.join(cwd, "loads.log");
        installCountingExtension(path.join(cwd, ".omp", "extensions"), log);
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        await session.engine.prompt("hello");

        const loads = recordedExtensionEvents(log);
        assert.deepEqual(loads, ["module", "factory"]);
    });
});

describe("proposal.0001 extension failures", () => {
    test("an extension whose factory throws is reported on stderr and the session still starts", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const broken = installThrowingFactoryExtension(
            path.join(cwd, ".omp", "extensions"),
            "PICO_FACTORY_FAILED",
        );
        const stderr = captureStderr(t);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.ok(stderr().includes(broken), `stderr does not name the extension: ${stderr()}`);
        assert.ok(
            stderr().includes("PICO_FACTORY_FAILED"),
            `stderr does not name the error: ${stderr()}`,
        );
    });
});

describe("proposal.0001 rewritten tool input", () => {
    test("a write an extension redirected is recorded against the file that changed", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const requested = path.join(cwd, "requested.txt");
        const actual = path.join(cwd, "actual.txt");
        fs.writeFileSync(requested, "untouched\n");
        fs.writeFileSync(actual, "before\n");
        installWriteRedirectingExtension(path.join(cwd, ".omp", "extensions"), "actual.txt");
        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({
                responses: [
                    { content: [toolCall("write", { path: "requested.txt", content: "after\n" })] },
                    { content: ["done"] },
                ],
            }),
        });
        t.after(() => session.dispose());
        const written = collectWrites(session);

        await session.engine.prompt("write requested.txt");

        assert.equal(fs.readFileSync(requested, "utf8"), "untouched\n");
        assert.equal(fs.readFileSync(actual, "utf8"), "after\n");
        assert.deepEqual(written, [{ path: actual, oldText: "before\n", newText: "after\n" }]);
    });
});
