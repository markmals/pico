import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { createAgentSession, getAgentDir, SessionManager } from "@oh-my-pi/pi-coding-agent";

import type { HostMcpServers } from "./host-mcp-servers.ts";
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
    /** Consumes what the `write` with this tool call id replaced, and what the file holds now. */
    takeRecordedWrite(toolCallId: string): RecordedWrite | undefined;
    /** Disconnects MCP servers, terminating the processes they spawned, and disposes the engine. Idempotent. */
    dispose(): Promise<void>;
}

export async function createPicoSession(options: PicoSessionOptions): Promise<PicoSession> {
    const { cwd, mcpServers } = options;
    const agentDir = options.agentDir ?? getAgentDir();
    // Only a store Pico opened is Pico's to close; an injected one belongs to its caller.
    const authStorage = options.authStorage ?? (await openCredentialStore(agentDir));
    const ownedStore = options.authStorage === undefined ? authStorage : undefined;

    let mcp: HostMcpServers | undefined;
    let engine: AgentSession | undefined;
    const writes = new WriteRecorder(cwd);
    try {
        const settings = await loadPicoSettings({ cwd, agentDir });
        mcp = await connectHostMcpServers(cwd, mcpServers, authStorage);
        const mcpToolNames = mcp.tools.map(tool => tool.name);
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
            preloadedPreparedExtensions: [
                writes.extension(),
                ...(await prepareDiscoveredExtensions(cwd, settings)),
            ],
            appendSystemPrompt: PICO_GUIDANCE,
            systemPrompt: withoutSubagentUrl,
        });
        engine = created.session;

        if (!engine.model) {
            const reason = created.modelFallbackMessage ? ` ${created.modelFallbackMessage}` : "";
            throw new PicoSessionError(
                `Oh My Pi has no model configured for ${cwd}, and Pico does not substitute one.${reason} ` +
                    "Configure a default model for this project in Oh My Pi, then start a new session.",
            );
        }

        const connected = mcp;
        engine.setMcpServerInstructionsSource(() => connected.manager.getServerInstructions());
        await engine.refreshMCPTools(mcp.tools);

        const unexpected = findUnexpectedTools(engine.getActiveToolNames(), [
            ...PICO_BUILTIN_TOOLS,
            ...mcpToolNames,
        ]);
        if (unexpected.length > 0) {
            throw new PicoSessionError(
                `Pico does not allow these tools, but the session activated them: ${unexpected.join(", ")}.`,
            );
        }
    } catch (error) {
        await engine?.dispose();
        await mcp?.manager.disconnectAll();
        ownedStore?.close();
        throw error instanceof PicoSessionError
            ? error
            : new PicoSessionError(describeCause(error));
    }

    const liveEngine = engine;
    const liveMcp = mcp;
    let disposed = false;
    return {
        engine,
        cwd,
        takeRecordedWrite: toolCallId => writes.take(toolCallId),
        dispose: async () => {
            if (disposed) return;
            disposed = true;
            await liveMcp.manager.disconnectAll();
            await liveEngine.dispose();
            ownedStore?.close();
        },
    };
}
