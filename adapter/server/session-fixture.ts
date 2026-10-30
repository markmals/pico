import type {
    ContentBlock,
    McpServerStdio,
    NewSessionResponse,
    PromptResponse,
    SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { Message } from "@oh-my-pi/pi-ai";
import type { MockModel, MockResponseSource } from "@oh-my-pi/pi-ai/providers/mock";

import type { ConnectedClient } from "./agent-harness.ts";

import { connectPicoAgent } from "./agent-harness.ts";
import { mockEngine, temporaryProject } from "./engine-harness.ts";

/** One connection, one engine-backed session, ready to prompt. */
export interface PicoTestSession {
    readonly client: ConnectedClient;
    readonly sessionId: string;
    readonly model: MockModel;
    readonly cwd: string;
    prompt(blocks: ContentBlock[] | string): Promise<PromptResponse>;
    updates(): SessionUpdate[];
}

const open: ConnectedClient[] = [];

export interface StartSessionOptions {
    cwd?: string;
    mcpServers?: McpServerStdio[];
}

export async function startPicoSession(
    responses: MockResponseSource,
    options: StartSessionOptions = {},
): Promise<PicoTestSession> {
    const cwd = options.cwd ?? temporaryProject();
    const engine = await mockEngine(responses);
    const client = connectPicoAgent({ version: "0.0.0-test", createSession: engine.createSession });
    open.push(client);
    await client.initialize();
    const response = (await client.agent.request("session/new", {
        cwd,
        mcpServers: options.mcpServers ?? [],
    })) as NewSessionResponse;
    const sessionId = response.sessionId;
    return {
        client,
        sessionId,
        cwd,
        model: engine.model,
        prompt: blocks =>
            client.agent.request("session/prompt", {
                sessionId,
                prompt: typeof blocks === "string" ? [{ type: "text", text: blocks }] : blocks,
            }) as Promise<PromptResponse>,
        updates: () => client.updatesFor(sessionId),
    };
}

export async function closeOpenConnections(): Promise<void> {
    for (const client of open.splice(0)) {
        await client.close();
    }
}

/** Everything the engine put in front of the model as user text for its last call. */
export function userText(model: MockModel): string {
    const messages = model.calls.at(-1)?.context.messages ?? [];
    return messages
        .filter(message => message.role === "user")
        .map(message =>
            typeof message.content === "string"
                ? message.content
                : message.content.map(block => (block.type === "text" ? block.text : "")).join(""),
        )
        .join("\n");
}

/**
 * The whole conversation the engine put in front of the model for its last call:
 * every message's text, with each tool the assistant called named as
 * `toolCall:<name>`.
 */
export function conversationText(model: MockModel): string {
    const messages = model.calls.at(-1)?.context.messages ?? [];
    return messages.map(describeMessage).join("\n");
}

function describeMessage(message: Message): string {
    if (message.role === "assistant") {
        return message.content
            .map(block => {
                if (block.type === "text") return block.text;
                if (block.type === "thinking") return block.thinking;
                return block.type === "toolCall" ? `toolCall:${block.name}` : "";
            })
            .join("\n");
    }
    if (typeof message.content === "string") return message.content;
    return message.content.map(block => (block.type === "text" ? block.text : "")).join("");
}

export function updateKinds(updates: SessionUpdate[]): string[] {
    return updates.map(update => update.sessionUpdate);
}

/**
 * A real pause. These tests watch for something that should *not* arrive — a late
 * update, a surviving subprocess — and the protocol announces no signal for either.
 */
export function settle(ms = 250): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}

/** Whether a process id still names a live process. */
export function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Polls until `condition` holds, giving up at `deadlineMs`. Used where the fact a
 * test waits on belongs to the operating system — a file appearing, a process
 * exiting — and the protocol announces nothing about it.
 */
export async function waitUntil(condition: () => boolean, deadlineMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + deadlineMs;
    while (!condition()) {
        if (Date.now() >= deadline) return false;
        await settle(25);
    }
    return true;
}
