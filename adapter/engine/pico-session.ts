import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { createAgentSession, getAgentDir, SessionManager } from "@oh-my-pi/pi-coding-agent";

import type { RecordedWrite } from "./write-recorder.ts";

import { PICO_GUIDANCE, withoutSubagentUrl } from "./agent-guidance.ts";
import { openCredentialStore } from "./credential-store.ts";
import { describeCause, PicoSessionError } from "./errors.ts";
import { connectHostMcpServers } from "./host-mcp-servers.ts";
import { loadPicoSettings } from "./pico-settings.ts";
import { prepareDiscoveredExtensions } from "./session-extensions.ts";
import { findUnexpectedTools, PICO_BUILTIN_TOOLS } from "./tool-roster.ts";
import { WriteRecorder } from "./write-recorder.ts";

export { PicoSessionError } from "./errors.ts";
export type { RecordedWrite } from "./write-recorder.ts";

export interface PicoSessionOptions {
    /** Absolute path to an existing directory; the only source of the working directory. */
    cwd: string;
    /** The stdio MCP servers the client sent. Nothing else is connected. */
    mcpServers: McpServerStdio[];
    /** Defaults to OMP's agent directory. */
    agentDir?: string;
    /** Defaults to the user's OMP credential store. */
    authStorage?: AuthStorage;
    /** Defaults to the model the user's OMP configuration resolves for `cwd`. */
    model?: Model<Api>;
}

export interface PicoSession {
    readonly engine: AgentSession;
    readonly cwd: string;
    /** Consumes (FIFO per path) what the write tool wrote to `absolutePath` and what was there before. */
    takeRecordedWrite(absolutePath: string): RecordedWrite | undefined;
    /** Disconnects MCP servers, terminating the processes they spawned, and disposes the engine. Idempotent. */
    dispose(): Promise<void>;
}

export async function createPicoSession(options: PicoSessionOptions): Promise<PicoSession> {
    const { cwd, mcpServers } = options;
    const agentDir = options.agentDir ?? getAgentDir();
    const authStorage = options.authStorage ?? (await openCredentialStore(agentDir));
    const settings = await loadPicoSettings({ cwd, agentDir });
    const mcp = await connectHostMcpServers(cwd, mcpServers, authStorage);

    const mcpToolNames = mcp.tools.map(tool => tool.name);
    let engine: AgentSession;
    let modelFallbackMessage: string | undefined;
    try {
        const created = await createAgentSession({
            cwd,
            agentDir,
            settings,
            authStorage,
            model: options.model,
            sessionManager: SessionManager.inMemory(cwd),
            enableMCP: false,
            enableLsp: false,
            hasUI: false,
            autoApprove: true,
            restrictToolNames: true,
            toolNames: [...PICO_BUILTIN_TOOLS, ...mcpToolNames],
            preloadedPreparedExtensions: await prepareDiscoveredExtensions(cwd, settings),
            appendSystemPrompt: PICO_GUIDANCE,
            systemPrompt: withoutSubagentUrl,
        });
        engine = created.session;
        modelFallbackMessage = created.modelFallbackMessage;
    } catch (error) {
        await mcp.manager.disconnectAll();
        throw new PicoSessionError(describeCause(error));
    }

    let disposed = false;
    const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await mcp.manager.disconnectAll();
        await engine.dispose();
    };
    const fail = async (message: string): Promise<never> => {
        await dispose();
        throw new PicoSessionError(message);
    };

    if (!engine.model) {
        const reason = modelFallbackMessage ? ` ${modelFallbackMessage}` : "";
        await fail(
            `Oh My Pi has no model configured for ${cwd}, and Pico does not substitute one.${reason} ` +
                "Configure a default model for this project in Oh My Pi, then start a new session.",
        );
    }

    await engine.refreshMCPTools(mcp.tools);
    const unexpected = findUnexpectedTools(engine.getActiveToolNames(), [
        ...PICO_BUILTIN_TOOLS,
        ...mcpToolNames,
    ]);
    if (unexpected.length > 0) {
        await fail(
            `Pico does not allow these tools, but the session activated them: ${unexpected.join(", ")}.`,
        );
    }

    const writes = new WriteRecorder();
    engine.setClientBridge(writes.bridge);

    return {
        engine,
        cwd,
        takeRecordedWrite: absolutePath => writes.take(absolutePath),
        dispose,
    };
}
