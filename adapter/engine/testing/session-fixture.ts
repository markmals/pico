/** Shared fixtures for the Pico engine tests: temporary workspaces, credentials, a deterministic model, and engine observation. */

import type { Api, AuthStorage, Context, Model } from "@oh-my-pi/pi-ai";
import type { MockHandler, MockModel, MockModelOptions } from "@oh-my-pi/pi-ai/providers/mock";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent";

import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MemorySecretStore } from "../../credentials/testing/memory-secret-store.ts";
import type { CredentialVault } from "../../credentials/vault.ts";
import type { PicoSession, RecordedChange } from "../pico-session.ts";

import { createMemorySecretStore } from "../../credentials/testing/memory-secret-store.ts";
import { openCredentialVault } from "../../credentials/vault.ts";
import { readSettings, writeSettings } from "../../settings/settings-store.ts";

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

/** The built-in tools proposal.0001 puts in every Pico session, with `todo` (proposal.0006) and `wait` (proposal.0008) returned. */
export const PICO_ROSTER = [
    "read",
    "grep",
    "glob",
    "edit",
    "write",
    "bash",
    "web_search",
    "todo",
    "wait",
];

/** Tools proposal.0001 excludes or defers; none of them may ever be active. */
export const EXCLUDED_TOOL_NAMES = [
    "eval",
    "lsp",
    "task",
    "ask",
    "find",
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
    // Realpathed: OMP resolves a read snapshot against the session cwd, and a
    // symlinked temporary root (macOS `/var` → `/private/var`) defeats that match.
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pico-${prefix}-`)));
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
    /** Stands in for `~/Library/Application Support/Pico`. */
    dataDir: string;
}

/**
 * A temporary working directory, OMP agent directory and Pico data directory, so no test
 * reads or writes the user's `~/.omp` or Pico's real data directory.
 */
export function picoWorkspace(t: Cleanups, agentConfig?: string): PicoWorkspace {
    const cwd = temporaryDirectory(t, "cwd");
    const agentDir = temporaryDirectory(t, "agent");
    const dataDir = temporaryDirectory(t, "data");
    if (agentConfig !== undefined) fs.writeFileSync(path.join(agentDir, "config.yml"), agentConfig);
    return { cwd, agentDir, dataDir };
}

/**
 * Pico's own credentials over `dataDir`, backed by an in-process Keychain: no test reaches the
 * real Keychain or the user's Oh My Pi store (proposal.0009).
 */
export async function picoCredentials(dataDir: string): Promise<PicoCredentialsFixture> {
    const keychain = createMemorySecretStore();
    const vault = openCredentialVault({ dataDir, keychain });
    const authStorage = await vault.authStorage(() => selectedReferences(dataDir));
    return {
        keychain,
        vault,
        authStorage,
        bind: (provider, key = "test") => {
            const metadata = vault.create(provider, { type: "api_key", key });
            const state = readSettings(dataDir);
            const item = "item" in state ? state.item : undefined;
            writeSettings(dataDir, {
                defaultModel: item?.defaultModel ?? null,
                defaultThinking: item?.defaultThinking ?? null,
                autoBackground: item?.autoBackground ?? null,
                intellisensePath: item?.intellisensePath ?? null,
                providerCredentials: {
                    ...item?.providerCredentials,
                    [provider]: metadata.reference,
                },
            });
            return metadata.reference;
        },
        close: () => {
            authStorage.close();
            vault.close();
        },
    };
}

/**
 * A Keychain holding one credential for `provider`, already bound in `dataDir`'s settings, for a
 * session that opens Pico's credentials itself. Pass the Keychain back as `keychain`.
 */
export async function boundCredential(
    dataDir: string,
    provider: string,
    key = "test",
): Promise<{ keychain: MemorySecretStore; reference: string }> {
    const credentials = await picoCredentials(dataDir);
    try {
        return { keychain: credentials.keychain, reference: credentials.bind(provider, key) };
    } finally {
        credentials.close();
    }
}

export interface PicoCredentialsFixture {
    /** The payloads the vault stored, so a test can remove or corrupt one the way a human would. */
    readonly keychain: MemorySecretStore;
    readonly vault: CredentialVault;
    readonly authStorage: AuthStorage;
    /** Stores an API key for `provider` and binds it in `dataDir`'s settings. */
    bind(provider: string, key?: string): string;
    close(): void;
}

/** The references Pico's settings currently select, as the session's own storage reads them. */
function selectedReferences(dataDir: string): readonly string[] {
    const state = readSettings(dataDir);
    return "item" in state ? Object.values(state.item.providerCredentials) : [];
}

/** Pico credentials holding the runtime key the mock provider needs, for a scripted session. */
export async function mockAuthStorage(dataDir: string): Promise<AuthStorage> {
    const { authStorage } = await picoCredentials(dataDir);
    authStorage.keys.setRuntime("mock", "test");
    return authStorage;
}

/** Pico credentials with no key for the mock provider. */
export async function unauthenticatedAuthStorage(dataDir: string): Promise<AuthStorage> {
    return (await picoCredentials(dataDir)).authStorage;
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

/** Denies writes to Pico's data directory the way Sesh's Autonomous sandbox denies `~/.omp`. */
export function denyDataDirectoryWrites(dataDir: string): void {
    for (const entry of fs.readdirSync(dataDir)) fs.chmodSync(path.join(dataDir, entry), 0o444);
    fs.chmodSync(dataDir, 0o555);
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
export function hashlineTag(context: Context, file: string): string {
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
