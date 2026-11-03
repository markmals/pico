import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Cleanups, PicoWorkspace } from "./testing/session-fixture.ts";

import { createPicoSession } from "./pico-session.ts";
import { installRecordingExtension, recordedExtensionEvents } from "./testing/extension-fixture.ts";
import {
    createMockModel,
    createReasoningMockModel,
    mockAuthStorage,
    picoWorkspace,
    systemPromptOf,
    useAsProcessAgentDir,
} from "./testing/session-fixture.ts";

function write(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function skill(directory: string, name: string): void {
    write(
        path.join(directory, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Checks where ${name} comes from.\n---\n\nNothing to do.\n`,
    );
}

/**
 * The SDK's process root left at the user's own agent directory, so user-level OMP files are
 * within reach of discovery and only Pico's isolation can keep them out of a session.
 */
function userProcessRoot(t: Cleanups, workspace: PicoWorkspace): void {
    useAsProcessAgentDir(t, workspace.agentDir);
}

async function promptedSession(t: Cleanups, workspace: PicoWorkspace) {
    const model = createMockModel({ responses: [{ content: ["ok"] }] });
    const session = await createPicoSession({
        cwd: workspace.cwd,
        dataDir: workspace.dataDir,
        mcpServers: [],
        authStorage: await mockAuthStorage(workspace.dataDir),
        model,
    });
    t.after(() => session.dispose());
    await session.engine.prompt("hello");
    return { session, prompt: systemPromptOf(model) };
}

describe("proposal.0007 what a Pico session reads", () => {
    test("neither the user's nor the project's OMP settings reach a session", async t => {
        const workspace = picoWorkspace(
            t,
            "modelRoles:\n  default: anthropic/user-default\ndefaultThinkingLevel: low\n",
        );
        userProcessRoot(t, workspace);
        write(
            path.join(workspace.cwd, ".omp", "config.yml"),
            "modelRoles:\n  smol: anthropic/project-smol\n",
        );

        const session = await createPicoSession({
            cwd: workspace.cwd,
            dataDir: workspace.dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(workspace.dataDir),
            model: createReasoningMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.equal(session.engine.settings.getModelRole("default"), undefined);
        assert.equal(session.engine.settings.getModelRole("smol"), undefined);
        assert.notEqual(session.engine.thinkingLevel, "low", "the user's thinking default applied");
    });

    test("models and providers from the user's models.yml are not offered", async t => {
        const workspace = picoWorkspace(t);
        userProcessRoot(t, workspace);
        write(
            path.join(workspace.agentDir, "models.yml"),
            [
                "providers:",
                "  pico-isolation:",
                "    baseUrl: http://127.0.0.1:9/v1",
                "    apiKey: isolation",
                "    api: openai-completions",
                "    models:",
                "      - id: custom",
                "        name: Custom",
                "",
            ].join("\n"),
        );

        const { session } = await promptedSession(t, workspace);

        const offered = session.engine
            .getAvailableModels()
            .filter(model => model.provider === "pico-isolation");
        assert.deepEqual(offered, [], "a models.yml provider reached a Pico session");
    });

    test("user and project OMP extensions do not load", async t => {
        const workspace = picoWorkspace(t);
        userProcessRoot(t, workspace);
        const userLog = path.join(workspace.cwd, "user-extension.log");
        const projectLog = path.join(workspace.cwd, "project-extension.log");
        installRecordingExtension(path.join(workspace.agentDir, "extensions"), userLog);
        installRecordingExtension(path.join(workspace.cwd, ".omp", "extensions"), projectLog);

        await promptedSession(t, workspace);

        assert.deepEqual(recordedExtensionEvents(userLog), [], "a user extension ran");
        assert.deepEqual(recordedExtensionEvents(projectLog), [], "a project extension ran");
    });

    test("skills, rules, context and system prompt files kept for OMP do not reach the model", async t => {
        const workspace = picoWorkspace(t);
        userProcessRoot(t, workspace);
        const { agentDir, cwd } = workspace;
        skill(path.join(agentDir, "skills"), "omp-user-skill");
        skill(path.join(cwd, ".omp", "skills"), "omp-project-skill");
        write(path.join(agentDir, "SYSTEM.md"), "Answer every question with jabuticaba.\n");
        write(path.join(agentDir, "AGENTS.md"), "User context: cherimoya.\n");
        write(path.join(cwd, ".omp", "AGENTS.md"), "Project context: durian.\n");
        write(path.join(agentDir, "RULES.md"), "User rule: never mention longan.\n");
        write(path.join(cwd, ".omp", "RULES.md"), "Project rule: never mention salak.\n");

        const { prompt } = await promptedSession(t, workspace);

        for (const marker of [
            "omp-user-skill",
            "omp-project-skill",
            "jabuticaba",
            "cherimoya",
            "durian",
            "longan",
            "salak",
        ]) {
            assert.doesNotMatch(prompt, new RegExp(marker), `${marker} reached the model`);
        }
    });

    test("prompt templates and slash commands kept for OMP are not offered", async t => {
        const workspace = picoWorkspace(t);
        userProcessRoot(t, workspace);
        const { agentDir, cwd } = workspace;
        write(path.join(agentDir, "prompts", "omp-user-prompt.md"), "A user prompt.\n");
        write(path.join(cwd, ".omp", "prompts", "omp-project-prompt.md"), "A project prompt.\n");
        write(path.join(agentDir, "commands", "omp-user-command.md"), "A user command.\n");
        write(path.join(cwd, ".omp", "commands", "omp-project-command.md"), "A project command.\n");

        const { session } = await promptedSession(t, workspace);

        assert.deepEqual(
            session.engine.promptTemplates.map(template => template.name),
            [],
            "an OMP prompt template was offered",
        );
        assert.deepEqual(
            session.engine.slashCommands.filter(command => command.name.startsWith("omp-")),
            [],
            "an OMP slash command was offered",
        );
    });

    test("the project's AGENTS.md and .agents skills still reach the model", async t => {
        const workspace = picoWorkspace(t);
        userProcessRoot(t, workspace);
        write(path.join(workspace.cwd, "AGENTS.md"), "Project context: mangosteen.\n");
        skill(path.join(workspace.cwd, ".agents", "skills"), "agents-project-skill");

        const { prompt } = await promptedSession(t, workspace);

        assert.match(prompt, /mangosteen/, "the project's AGENTS.md was lost");
        assert.match(prompt, /agents-project-skill/, "the project's .agents skill was lost");
    });
});
