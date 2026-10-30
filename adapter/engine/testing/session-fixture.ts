/** Shared fixtures for the Pico engine tests: temporary workspaces, credentials, a deterministic model, and engine observation. */

import type { Api, AuthStorage, Context, Model } from "@oh-my-pi/pi-ai";
import type { MockHandler, MockModel, MockModelOptions } from "@oh-my-pi/pi-ai/providers/mock";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent";

import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PicoSession, RecordedChange } from "../pico-session.ts";

export { createMockModel };

registerMockApi();

// `Effort` is a const enum, so its members cannot be written as literals here.
const THINKING_LADDER = { efforts: ["low", "medium", "high"] } as unknown as NonNullable<
    Model<Api>["thinking"]
>;

/**
 * A mock model that advertises a thinking ladder. Oh My Pi clamps every thinking
 * level against the selected model's ladder, so a model without one resolves to
 * no level at all.
 */
export function createReasoningMockModel(options: MockModelOptions = {}): Model<Api> {
    return Object.assign(createMockModel({ ...options, reasoning: true }), {
        thinking: THINKING_LADDER,
    });
}

/** The built-in tools proposal.0001 puts in every Pico session. */
export const PICO_ROSTER = ["read", "grep", "glob", "edit", "write", "bash", "web_search"];

/** Tools proposal.0001 excludes or defers; none of them may ever be active. */
export const EXCLUDED_TOOL_NAMES = [
    "eval",
    "lsp",
    "task",
    "ask",
    "todo",
    "find",
    "wait",
    "ast_grep",
    "ast_edit",
    "checkpoint",
    "rewind",
    "debug",
    "memory_edit",
    "retain",
    "recall",
    "reflect",
    "learn",
    "manage_skill",
    "vibe_spawn",
    "vibe_send",
    "vibe_wait",
    "vibe_kill",
    "vibe_list",
];

/** The slice of `node:test`'s context these fixtures need. */
export interface Cleanups {
    after(cleanup: () => void | Promise<void>): void;
}

export function temporaryDirectory(t: Cleanups, prefix: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `pico-${prefix}-`));
    t.after(() => {
        // The credential-store tests lock their agent directory; unlock it so the removal succeeds.
        fs.chmodSync(directory, 0o755);
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

export interface PicoWorkspace {
    cwd: string;
    agentDir: string;
}

/** A temporary working directory and OMP agent directory, so no test reads or writes the user's `~/.omp`. */
export function picoWorkspace(t: Cleanups, agentConfig?: string): PicoWorkspace {
    const cwd = temporaryDirectory(t, "cwd");
    const agentDir = temporaryDirectory(t, "agent");
    if (agentConfig !== undefined) fs.writeFileSync(path.join(agentDir, "config.yml"), agentConfig);
    return { cwd, agentDir };
}

/** A credential store in `agentDir` holding the runtime key the mock provider needs. */
export async function mockAuthStorage(agentDir: string): Promise<AuthStorage> {
    const authStorage = await discoverAuthStorage(agentDir);
    authStorage.keys.setRuntime("mock", "test");
    return authStorage;
}

/** A credential store in `agentDir` with no key for the mock provider. */
export function unauthenticatedAuthStorage(agentDir: string): Promise<AuthStorage> {
    return discoverAuthStorage(agentDir);
}

/** Persists the mock provider's key in `agentDir`, for a session that opens its own credential store. */
export function writeMockProviderKey(agentDir: string): void {
    fs.writeFileSync(path.join(agentDir, "models.yml"), "providers:\n  mock:\n    apiKey: test\n");
}

/**
 * Makes `agentDir` the process's OMP agent directory for one test. User-level
 * extension discovery reads the process agent directory rather than the one a
 * session was created with, so a temporary directory can only stand in for the
 * user's `~/.omp/agent` this way.
 */
export function useAsProcessAgentDir(t: Cleanups, agentDir: string): void {
    const previousDir = getAgentDir();
    const previousEnv = process.env.PI_CODING_AGENT_DIR;
    setAgentDir(agentDir);
    t.after(() => {
        setAgentDir(previousDir);
        if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousEnv;
    });
}

/** Creates the credential store in `agentDir`, then denies writes to it the way Sesh's Autonomous sandbox does. */
export async function lockCredentialStore(agentDir: string): Promise<void> {
    const storage = await discoverAuthStorage(agentDir);
    storage.close();
    for (const entry of fs.readdirSync(agentDir)) fs.chmodSync(path.join(agentDir, entry), 0o444);
    fs.chmodSync(agentDir, 0o555);
}

/** API keys OMP reads straight from the environment, which would otherwise resolve a model for a bare agent directory. */
const CREDENTIAL_ENV_PATTERN = /(_KEY|_TOKEN|_CREDENTIALS)$/;

/** Hides the machine's provider credentials for one test, so "no model configured" is the real state. */
export function withoutProviderCredentials(t: Cleanups): void {
    const hidden: [string, string][] = [];
    for (const [variable, value] of Object.entries(process.env)) {
        if (value === undefined || !CREDENTIAL_ENV_PATTERN.test(variable)) continue;
        hidden.push([variable, value]);
        delete process.env[variable];
    }
    t.after(() => {
        for (const [variable, value] of hidden) process.env[variable] = value;
    });
}

/** Everything Pico writes to stderr while the test runs. */
export function captureStderr(t: Cleanups): () => string {
    const original = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        return (original as (...args: never[]) => boolean)(chunk as never, ...(rest as never[]));
    }) as typeof process.stderr.write;
    t.after(() => {
        process.stderr.write = original;
    });
    return () => captured;
}

/** A scripted tool call; `id` pins the engine's tool call id so a test can look its record up. */
export function toolCall(name: string, args: Record<string, unknown> = {}, id?: string) {
    return {
        type: "toolCall" as const,
        name,
        arguments: args,
        ...(id === undefined ? {} : { id }),
    };
}

/** The hashline tag the most recent tool result served for `file`. */
function hashlineTag(context: Context, file: string): string {
    const transcript = JSON.stringify(context.messages);
    const marker = `[${file}#`;
    const at = transcript.lastIndexOf(marker);
    if (at === -1) throw new Error(`no hashline tag for ${file} in any preceding tool result`);
    return transcript.slice(at + marker.length, at + marker.length + 4);
}

/**
 * An `edit` call built from the hashline tag the preceding `read` returned: the
 * edit tool rejects an input whose tag does not match the file it last served.
 */
export function editAfterRead(file: string, hunk: string, id?: string): MockHandler {
    return context => ({
        content: [
            toolCall("edit", { input: `[${file}#${hashlineTag(context, file)}]\n${hunk}` }, id),
        ],
    });
}

/** A `write` whose `path` is the hashline header a `read` returned, as a model that pastes one sends it. */
export function writeToHashlineHeader(file: string, content: string, id: string): MockHandler {
    return context => ({
        content: [
            toolCall("write", { path: `[${file}#${hashlineTag(context, file)}]`, content }, id),
        ],
    });
}

/** One assistant message that edits `file` and then overwrites it, so both calls share a batch. */
export function editThenWrite(
    file: string,
    hunk: string,
    content: string,
    writeId: string,
): MockHandler {
    return context => ({
        content: [
            toolCall("edit", { input: `[${file}#${hashlineTag(context, file)}]\n${hunk}` }),
            toolCall("write", { path: file, content }, writeId),
        ],
    });
}

/** One `edit` call spanning several files, each section built from that file's hashline tag. */
export function editFiles(
    sections: ReadonlyArray<{ file: string; body: string }>,
    id: string,
): MockHandler {
    return context => ({
        content: [
            toolCall(
                "edit",
                {
                    input: sections
                        .map(
                            section =>
                                `[${section.file}#${hashlineTag(context, section.file)}]\n${section.body}`,
                        )
                        .join("\n"),
                },
                id,
            ),
        ],
    });
}

/** The system prompt the model received on `call`, as one string. */
export function systemPromptOf(model: MockModel, call = 0): string {
    const received = model.calls[call];
    if (received === undefined) throw new Error(`the model was not called ${call + 1} time(s)`);
    return (received.context.systemPrompt ?? []).join("\n");
}

export interface ToolExecution {
    name: string;
    isError: boolean;
    text: string;
}

function resultText(result: unknown): string {
    if (typeof result !== "object" || result === null || !("content" in result)) return "";
    const { content } = result;
    if (!Array.isArray(content)) return "";
    const texts: string[] = [];
    for (const block of content) {
        if (
            typeof block === "object" &&
            block !== null &&
            "text" in block &&
            typeof block.text === "string"
        ) {
            texts.push(block.text);
        }
    }
    return texts.join("");
}

/**
 * Takes each write record as the turn produces it, the way the mapper does: the
 * session clears what nothing took when the turn ends.
 */
export function collectWrites(
    session: Pick<PicoSession, "engine" | "takeChanges">,
): RecordedChange[] {
    const taken: RecordedChange[] = [];
    session.engine.subscribe((event: AgentSessionEvent) => {
        if (event.type !== "tool_execution_end") return;
        taken.push(...session.takeChanges(event.toolCallId));
    });
    return taken;
}

/** The ids of the tool calls the engine executed, in order. */
export function collectToolCallIds(engine: AgentSession): string[] {
    const ids: string[] = [];
    engine.subscribe((event: AgentSessionEvent) => {
        if (event.type === "tool_execution_end") ids.push(event.toolCallId);
    });
    return ids;
}

/** Collects every tool the engine actually executed, in order. */
export function recordToolExecutions(engine: AgentSession): ToolExecution[] {
    const executions: ToolExecution[] = [];
    engine.subscribe((event: AgentSessionEvent) => {
        if (event.type !== "tool_execution_end") return;
        executions.push({
            name: event.toolName,
            isError: event.isError === true,
            text: resultText(event.result),
        });
    });
    return executions;
}
