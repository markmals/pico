import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";

import { createAgentSession, getAgentDir, SessionManager } from "@oh-my-pi/pi-coding-agent";

import type { HostMcpServers } from "./host-mcp-servers.ts";
import type { RecordedChange } from "./write-bridge.ts";

import { PICO_GUIDANCE, withoutSubagentUrl } from "./agent-guidance.ts";
import { openCredentialStore } from "./credential-store.ts";
import { describeCause, PicoSessionError } from "./errors.ts";
import { connectHostMcpServers } from "./host-mcp-servers.ts";
import { loadPicoSettings } from "./pico-settings.ts";
import { prepareDiscoveredExtensions, reportExtensionFailure } from "./session-extensions.ts";
import { findUnexpectedTools, PICO_BUILTIN_TOOLS } from "./tool-roster.ts";
import { WriteBridge } from "./write-bridge.ts";

export { PicoSessionError } from "./errors.ts";
export type { RecordedChange } from "./write-bridge.ts";

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

/** Which MCP server a mounted tool came from, and its name on that server. */
export interface McpToolIdentity {
    server: string;
    tool: string;
}

/** The teardown step `dispose()` is on, for shutdown diagnostics. */
export type DisposalPhase = "disconnecting MCP servers" | "disposing the engine";

export interface PicoSession {
    readonly engine: AgentSession;
    readonly cwd: string;
    /**
     * The teardown step currently running: `undefined` before `dispose()` and once it has completed,
     * and the outstanding step for as long as teardown hangs or after it fails.
     */
    readonly disposalPhase: DisposalPhase | undefined;
    /** Consumes what the tool call with this id changed, one entry per affected file. */
    takeChanges(toolCallId: string): RecordedChange[];
    /** The server and tool an active `mcp__…` tool came from, as its connection reported them. */
    mcpToolIdentity(toolName: string): McpToolIdentity | undefined;
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
    const writes = new WriteBridge(cwd);
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
        // Oh My Pi skips an extension whose factory throws and logs it to a file;
        // the failure has to reach the session's stderr to be seen.
        for (const failure of created.extensionsResult.errors) {
            reportExtensionFailure(failure.path, failure.error);
        }

        const model = engine.model;
        if (!model) {
            const reason = created.modelFallbackMessage ? ` ${created.modelFallbackMessage}` : "";
            throw new PicoSessionError(
                `Oh My Pi has no model configured for ${cwd}, and Pico does not substitute one.${reason} ` +
                    "Configure a default model for this project in Oh My Pi, then start a new session.",
            );
        }
        // A fallback message alongside a resolved model means Oh My Pi picked a
        // different model than the configuration asked for.
        if (options.model === undefined && created.modelFallbackMessage) {
            throw new PicoSessionError(
                `Oh My Pi did not use the model configured for ${cwd}: ${created.modelFallbackMessage}. ` +
                    "Pico does not substitute another model; fix the configured model, then start a new session.",
            );
        }
        await verifyCredentials(engine, model);

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

        engine.setClientBridge(writes.bridge);
        // A write whose tool call then failed must not be reported against a later turn.
        engine.subscribe(event => {
            if (event.type === "agent_end") writes.clear();
        });
    } catch (error) {
        // Every owned resource is released even when an earlier release fails;
        // the startup failure is what the caller needs to see, not a teardown one.
        await attempt(() => engine?.dispose());
        await attempt(() => mcp?.manager.disconnectAll());
        await attempt(() => ownedStore?.close());
        throw error instanceof PicoSessionError
            ? error
            : new PicoSessionError(describeCause(error));
    }

    const liveEngine = engine;
    const liveMcp = mcp;
    const identities = mcpToolIdentities(mcp.tools);
    let disposed = false;
    let disposalPhase: DisposalPhase | undefined;
    return {
        engine,
        cwd,
        get disposalPhase() {
            return disposalPhase;
        },
        takeChanges: toolCallId => writes.takeChanges(toolCallId),
        mcpToolIdentity: toolName => identities.get(toolName),
        dispose: async () => {
            if (disposed) return;
            disposed = true;
            disposalPhase = "disconnecting MCP servers";
            const disconnected = await attempt(() => liveMcp.manager.disconnectAll());
            disposalPhase = "disposing the engine";
            const engineDisposed = await attempt(() => liveEngine.dispose());
            const storeClosed = await attempt(() => ownedStore?.close());
            const failure = disconnected ?? engineDisposed ?? storeClosed;
            if (failure) {
                // Leave the phase naming the step that failed, for the shutdown log.
                disposalPhase =
                    disconnected === undefined
                        ? "disposing the engine"
                        : "disconnecting MCP servers";
                throw failure.error;
            }
            disposalPhase = undefined;
        },
    };
}

/** Runs one teardown step, reporting its failure instead of abandoning the steps after it. */
async function attempt(step: () => Promise<void> | void): Promise<{ error: unknown } | undefined> {
    try {
        await step();
        return undefined;
    } catch (error) {
        return { error };
    }
}

/**
 * The server and tool name each mounted MCP tool reports for itself. The minted
 * `mcp__<server>_<tool>` name cannot be split back apart — both halves are
 * sanitized and an overlong name is hashed — so the identity comes from the
 * connection instead.
 */
function mcpToolIdentities(tools: readonly CustomTool[]): Map<string, McpToolIdentity> {
    const identities = new Map<string, McpToolIdentity>();
    for (const tool of tools) {
        if (!("mcpServerName" in tool) || typeof tool.mcpServerName !== "string") continue;
        if (!("mcpToolName" in tool) || typeof tool.mcpToolName !== "string") continue;
        identities.set(tool.name, { server: tool.mcpServerName, tool: tool.mcpToolName });
    }
    return identities;
}

/**
 * Resolves the selected model's real credential — running a command-backed key
 * and refreshing OAuth in place, exactly as a request would — so a session only
 * exists when its first prompt can reach the provider. The session id is the
 * same identity OMP's own requests resolve under, so a provider holding several
 * session-sticky accounts picks this session's.
 */
async function verifyCredentials(engine: AgentSession, model: Model<Api>): Promise<void> {
    const named = `${model.provider}/${model.id}`;
    let credential: string | undefined;
    try {
        credential = await engine.modelRegistry.getApiKey(model, engine.sessionId);
    } catch (error) {
        throw new PicoSessionError(
            `Pico could not use the credentials for ${named}: ${describeCause(error)}`,
        );
    }
    if (credential === undefined) {
        throw new PicoSessionError(
            `Pico could not use the credentials for ${named}: Oh My Pi resolved no usable API key for ${model.provider}. ` +
                "Sign in to that provider in Oh My Pi, then start a new session.",
        );
    }
}
