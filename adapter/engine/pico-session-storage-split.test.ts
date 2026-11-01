import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, getBlobsDir, setAgentDir } from "@oh-my-pi/pi-utils";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Cleanups, PicoWorkspace } from "./testing/session-fixture.ts";

import { createPicoSession } from "./pico-session.ts";
import { initializeRuntimeStorage } from "./runtime-storage.ts";
import { installRecordingExtension, recordedExtensionEvents } from "./testing/extension-fixture.ts";
import {
    createMockModel,
    createReasoningMockModel,
    mockAuthStorage,
    picoWorkspace,
    systemPromptOf,
    useAsProcessAgentDir,
    writeMockProviderKey,
} from "./testing/session-fixture.ts";

/**
 * The split proposal.0004 makes: Pico's own engine directory becomes the SDK's
 * process-wide runtime storage root, while the user's agent directory stays the
 * configuration source every session is given explicitly. `initializeRuntimeStorage`
 * performs this redirect once at startup; a test performs it for one session.
 */
function splitProcessRoot(t: Cleanups, dataDir: string): string {
    const engineDir = path.join(dataDir, "engine");
    fs.mkdirSync(engineDir, { recursive: true });
    useAsProcessAgentDir(t, engineDir);
    return engineDir;
}

function write(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function skill(directory: string, name: string, description: string): void {
    write(
        path.join(directory, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\n\nNothing to do.\n`,
    );
}

/** Moves the process agent directory as often as one test needs, restoring the real one afterwards. */
function switchableProcessRoot(t: Cleanups): (directory: string) => void {
    const original = getAgentDir();
    const originalVariable = process.env.PI_CODING_AGENT_DIR;
    t.after(() => {
        setAgentDir(original);
        if (originalVariable === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = originalVariable;
    });
    return setAgentDir;
}

/** The skills a session offers the model, as its prompt names them: `<name>: <description>`. */
async function skillCatalog(t: Cleanups, workspace: PicoWorkspace): Promise<string[]> {
    const model = createMockModel({ responses: [{ content: ["ok"] }] });
    const session = await createPicoSession({
        ...workspace,
        mcpServers: [],
        authStorage: await mockAuthStorage(workspace.agentDir),
        model,
    });
    t.after(() => session.dispose());
    await session.engine.prompt("hello");

    const listed = /<skills>\n([\s\S]*?)\n<\/skills>/.exec(systemPromptOf(model));
    assert.ok(listed, "the session's prompt lists no skills at all");
    return listed[1].split("\n").toSorted();
}

describe("proposal.0004 runtime storage", () => {
    test("the redirect moves the SDK's storage without moving what Pico launches", async t => {
        const { agentDir, dataDir } = picoWorkspace(t);
        fs.chmodSync(dataDir, 0o755);
        // The user's own directory, as the process resolves it before Pico starts.
        useAsProcessAgentDir(t, agentDir);
        process.env.OMP_PROFILE = "pico-split-profile";
        t.after(() => delete process.env.OMP_PROFILE);

        const configSource = initializeRuntimeStorage(dataDir);
        assert.equal(
            fs.statSync(path.join(dataDir, "engine")).mode & 0o777,
            0o700,
            "SDK history support must stay private even when the parent directory already existed",
        );

        assert.equal(
            configSource,
            agentDir,
            "the user's configuration directory was not reported back",
        );
        assert.ok(
            getBlobsDir().startsWith(path.join(dataDir, "engine")),
            "the SDK still stores blobs in the user's agent directory",
        );
        assert.equal(
            process.env.PI_CODING_AGENT_DIR,
            agentDir,
            "an MCP server or Sesh child session would start in Pico's storage",
        );
        assert.equal(
            process.env.OMP_PROFILE,
            "pico-split-profile",
            "a process Pico launches lost the user's profile",
        );
    });
});

describe("proposal.0004 configuration after the storage split", () => {
    test("a user extension in the user's agent directory still runs", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        const log = path.join(cwd, "user-extension.log");
        installRecordingExtension(path.join(agentDir, "extensions"), log);

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
            "the user's extension never ran once Pico's engine directory became the process root",
        );
    });

    test("a user skill in the user's agent directory still reaches the session", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        skill(path.join(cwd, ".omp", "skills"), "pico-project-skill", "Checks a project skill.");
        skill(path.join(agentDir, "skills"), "pico-user-skill", "Checks a user skill.");

        const model = createMockModel({ responses: [{ content: ["ok"] }] });
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

        const prompt = systemPromptOf(model);
        assert.match(prompt, /pico-project-skill/, "no skill at all reaches this session's prompt");
        assert.match(
            prompt,
            /pico-user-skill/,
            "the user's skill was lost once Pico's engine directory became the process root",
        );
    });

    test("a user skill that collides with a project skill keeps the identity it has unsplit", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const engineDir = path.join(dataDir, "engine");
        fs.mkdirSync(engineDir, { recursive: true });
        const processRoot = switchableProcessRoot(t);
        skill(path.join(cwd, ".omp", "skills"), "pico-overlap", "The project's version.");
        skill(path.join(agentDir, "skills"), "pico-overlap", "The user's version.");
        skill(path.join(agentDir, "skills"), "pico-user-only", "Only the user has this one.");

        processRoot(agentDir);
        const unsplit = await skillCatalog(t, { cwd, agentDir, dataDir });
        processRoot(engineDir);
        const split = await skillCatalog(t, { cwd, agentDir, dataDir });

        assert.ok(
            unsplit.some(entry => entry.includes("pico-user-only")),
            "the user's skills do not reach a session even without the split",
        );
        assert.deepEqual(
            split,
            unsplit,
            "the split renames the colliding skills or hands the bare name to the other one",
        );
    });

    test("the user's own SYSTEM.md still reaches the session", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        write(path.join(agentDir, "SYSTEM.md"), "Answer every question with jabuticaba.\n");

        const model = createMockModel({ responses: [{ content: ["ok"] }] });
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
            /jabuticaba/,
            "the user's system prompt was lost once Pico's engine directory became the process root",
        );
    });

    test("the user's own AGENTS.md still reaches the session", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        write(path.join(cwd, ".omp", "AGENTS.md"), "Project context: durian.\n");
        write(path.join(agentDir, "AGENTS.md"), "User context: cherimoya.\n");

        const model = createMockModel({ responses: [{ content: ["ok"] }] });
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

        const prompt = systemPromptOf(model);
        assert.match(prompt, /durian/, "no context file at all reaches this session's prompt");
        assert.match(
            prompt,
            /cherimoya/,
            "the user's AGENTS.md was lost once Pico's engine directory became the process root",
        );
    });

    test("the user's own RULES.md still reaches the session", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        write(path.join(cwd, ".omp", "RULES.md"), "Project rule: never mention salak.\n");
        write(path.join(agentDir, "RULES.md"), "User rule: never mention longan.\n");

        const model = createMockModel({ responses: [{ content: ["ok"] }] });
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

        const prompt = systemPromptOf(model);
        assert.match(prompt, /salak/, "no sticky rule at all reaches this session's prompt");
        assert.match(
            prompt,
            /longan/,
            "the user's RULES.md was lost once Pico's engine directory became the process root",
        );
    });

    test("the user's settings still select this session's thinking level", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t, "defaultThinkingLevel: low\n");
        splitProcessRoot(t, dataDir);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createReasoningMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.equal(session.engine.thinkingLevel, "low");
    });

    test("credentials stay in the user's agent directory and are not copied into Pico's", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        const engineDir = splitProcessRoot(t, dataDir);
        writeMockProviderKey(agentDir);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());
        await session.engine.prompt("hello");

        assert.ok(
            fs.existsSync(path.join(agentDir, "agent.db")),
            "the credential store was not opened in the user's agent directory",
        );
        assert.deepEqual(
            fs
                .readdirSync(engineDir)
                .filter(entry => entry.startsWith("agent.db") || entry === "models.yml"),
            [],
            "Pico's engine directory holds a copy of the user's credentials",
        );
    });

    test("a saved conversation stays in Pico's storage and adds no history to the user's agent directory", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        splitProcessRoot(t, dataDir);
        writeMockProviderKey(agentDir);
        const sessionDir = path.join(dataDir, "sessions", path.basename(cwd));
        fs.mkdirSync(sessionDir, { recursive: true });
        const manager = await SessionManager.inMemory(cwd).persistCopy({
            sessionDir,
            suppressBreadcrumb: true,
        });
        const file = manager.getSessionFile();
        assert.ok(file, "the journal was never materialized");

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
            sessionManager: manager,
        });
        await session.engine.prompt("remember rambutan");
        await session.dispose();

        assert.ok(file.startsWith(sessionDir), "the journal is not in Pico's own session bucket");
        assert.match(
            fs.readFileSync(file, "utf8"),
            /rambutan/,
            "the conversation never reached Pico's journal",
        );
        for (const entry of ["sessions", "blobs", "history.db"]) {
            assert.ok(
                !fs.existsSync(path.join(agentDir, entry)),
                `the user's agent directory gained ${entry}`,
            );
        }
    });
});
