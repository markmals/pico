import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";
import type { AgentSession, ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
import type { ConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";

import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";

import type { SecretStore } from "../credentials/keychain.ts";
import type { PicoCredentials } from "./credential-policy.ts";
import type { HostMcpServers } from "./host-mcp-servers.ts";
import type { RecordedChange } from "./write-bridge.ts";

import { DEFAULT_AUTO_BACKGROUND } from "../settings/settings-document.ts";
import { PICO_GUIDANCE, withoutSubagentUrl } from "./agent-guidance.ts";
import { BackgroundJobs, STOP_GRACE_MS } from "./background-jobs.ts";
import { openPicoCredentials } from "./credential-policy.ts";
import { attempt, describeCause, PicoSessionError } from "./errors.ts";
import { connectHostMcpServers } from "./host-mcp-servers.ts";
import {
    createPicoModelRegistry,
    findCatalogModel,
    offersThinking,
    thinkingChoices,
} from "./model-catalog.ts";
import { picoSettings } from "./pico-settings.ts";
import { ensureEngineDirectory } from "./runtime-storage.ts";
import { findUnexpectedTools, PICO_BUILTIN_TOOLS } from "./tool-roster.ts";
import { WriteBridge } from "./write-bridge.ts";

export { PicoSessionError } from "./errors.ts";
export type { RecordedChange } from "./write-bridge.ts";

export interface PicoSessionOptions {
    /** Absolute path to an existing directory; the only source of the working directory. */
    cwd: string;
    /** The stdio MCP servers the client sent. Nothing else is connected. */
    mcpServers: McpServerStdio[];
    /** Pico's data directory, which must exist: the model cache and the SDK's own root live here. */
    dataDir: string;
    /** Defaults to Pico's own Keychain-backed credentials for `dataDir` (proposal.0009). */
    authStorage?: AuthStorage;
    /** An in-process Keychain for tests; production always uses the native bridge (proposal.0009). */
    keychain?: SecretStore;
    /** A model outside every catalog, for tests that script the engine directly. */
    model?: Model<Api>;
    /** Pico's saved default for a new session; omitted for a reopened one or when none is saved. */
    startOn?: SavedDefault;
    /** Whether a slow plain command moves to the background; Pico's settings decide it, on when unset. */
    autoBackground?: boolean;
    /** Defaults to Pico's registry over the credential store; tests add their own provider to one. */
    modelRegistry?: ModelRegistry;
    /** Engine-owned journal; omit for ephemeral sessions. The engine closes a supplied manager. */
    sessionManager?: SessionManager;
}

/** The default model and thinking level saved in Pico settings, as their `provider/id` and level. */
export interface SavedDefault {
    defaultModel: string;
    defaultThinking: string;
}

/** Which MCP server a mounted tool came from, and its name on that server. */
export interface McpToolIdentity {
    server: string;
    tool: string;
}

/** The teardown step `dispose()` is on, for shutdown diagnostics. */
export type DisposalPhase =
    | "stopping background jobs"
    | "disconnecting MCP servers"
    | "disposing the engine";

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
    /** Resolves once no write Pico started is still reaching the filesystem. */
    writesSettled(): Promise<void>;
    /** The server and tool an active `mcp__…` tool came from, as its connection reported them. */
    mcpToolIdentity(toolName: string): McpToolIdentity | undefined;
    /**
     * Resolves once no background job runs, no finished job's result is still on its way to the
     * model, and the engine is idle, or as soon as `stopRequested()` holds (proposal.0008).
     */
    settleBackgroundWork(stopRequested: () => boolean): Promise<void>;
    /**
     * Stops every running background job and keeps finished jobs' results from starting a run;
     * resolves false when a job's processes are still running after 5 seconds.
     */
    stopBackgroundJobs(): Promise<boolean>;
    /**
     * Selects and journals a session-local model without changing OMP defaults.
     * Credential failure throws PicoSessionError without switching models.
     */
    selectModel(model: Model<Api>): Promise<void>;
    /** Selects and journals this session's thinking level without changing OMP defaults. */
    selectThinkingLevel(level: ConfiguredThinkingLevel): void;
    /** Stops background jobs, disconnects MCP servers, terminating the processes they spawned, and disposes the engine. Idempotent. */
    dispose(): Promise<void>;
}

export async function createPicoSession(options: PicoSessionOptions): Promise<PicoSession> {
    const { cwd, mcpServers } = options;
    // Only credentials Pico opened are Pico's to close; an injected store belongs to its caller.
    // Opening them can fail on its own — unusable settings, an unreachable Keychain — and that
    // is a session that did not start, not a raw storage error.
    const owned =
        options.authStorage === undefined
            ? await attemptOpen(() =>
                  openPicoCredentials({
                      dataDir: options.dataDir,
                      keychain: options.keychain,
                  }),
              )
            : undefined;
    const authStorage = options.authStorage ?? owned!.authStorage;

    let mcp: HostMcpServers | undefined;
    let engine: AgentSession | undefined;
    const writes = new WriteBridge();
    try {
        const settings = picoSettings(options.autoBackground ?? DEFAULT_AUTO_BACKGROUND);
        mcp = await connectHostMcpServers(cwd, mcpServers, authStorage);
        const mcpToolNames = mcp.tools.map(tool => tool.name);
        const modelRegistry =
            options.modelRegistry ??
            owned?.registry ??
            createPicoModelRegistry(authStorage, options.dataDir);
        // Resolved before the background refresh starts: OMP's registry does not serialize
        // refreshes, and a lookup racing one sees an empty catalog on a cold cache.
        const start = options.startOn && (await savedDefaultChoice(modelRegistry, options.startOn));
        // Oh My Pi only starts the refresh for a registry it built itself.
        modelRegistry.refreshInBackground();
        const created = await createAgentSession({
            cwd,
            // The SDK's own root for user-level lookups and storage, never the user's ~/.omp.
            agentDir: ensureEngineDirectory(options.dataDir),
            settings,
            authStorage,
            modelRegistry,
            model: options.model ?? start?.model,
            thinkingLevel: start?.thinkingLevel,
            sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
            enableMCP: false,
            enableLsp: false,
            hasUI: false,
            autoApprove: true,
            restrictToolNames: true,
            toolNames: [...PICO_BUILTIN_TOOLS, ...mcpToolNames],
            promptTemplates: [],
            preloadedPreparedExtensions: [writes.extension()],
            appendSystemPrompt: PICO_GUIDANCE,
            systemPrompt: withoutSubagentUrl,
        });
        engine = created.session;
        const extensionFailure = created.extensionsResult.errors[0];
        if (extensionFailure) {
            throw new PicoSessionError(
                `Pico's own extension failed to load from ${extensionFailure.path}: ${extensionFailure.error}`,
            );
        }

        const model = engine.model;
        if (!model) {
            const reason = created.modelFallbackMessage ? ` ${created.modelFallbackMessage}` : "";
            throw new PicoSessionError(
                `No model has usable credentials, so Pico has nothing to start a session in ${cwd} on, and it does not substitute one.${reason} ` +
                    "Connect a provider with `pico auth login` or `pico credentials create`, select it with `pico providers update`, then start a new session.",
            );
        }
        // A fallback message alongside a resolved model means Oh My Pi picked a different
        // model than the reopened session's journal asked for.
        if (options.model === undefined && created.modelFallbackMessage) {
            throw new PicoSessionError(
                `Oh My Pi did not use this session's saved model: ${created.modelFallbackMessage}. ` +
                    "Pico does not substitute another model; start a new session instead.",
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
        await attempt(() => owned?.close());
        throw error instanceof PicoSessionError
            ? error
            : new PicoSessionError(describeCause(error));
    }

    const liveEngine = engine;
    const liveMcp = mcp;
    const identities = mcpToolIdentities(mcp.tools);
    const jobs = new BackgroundJobs(liveEngine);
    let disposed = false;
    let disposalPhase: DisposalPhase | undefined;
    return {
        engine,
        cwd,
        get disposalPhase() {
            return disposalPhase;
        },
        takeChanges: toolCallId => writes.takeChanges(toolCallId),
        writesSettled: () => writes.writesSettled(),
        mcpToolIdentity: toolName => identities.get(toolName),
        settleBackgroundWork: stopRequested => jobs.settle(stopRequested),
        stopBackgroundJobs: () => jobs.stop(),
        selectModel: async model => {
            await verifyCredentials(liveEngine, model);
            await liveEngine.setModelTemporary(model);
        },
        selectThinkingLevel: level => liveEngine.setThinkingLevel(level, false),
        dispose: async () => {
            if (disposed) return;
            disposed = true;
            disposalPhase = "stopping background jobs";
            let jobsStopped = false;
            const stopFailed = await attempt(async () => {
                jobsStopped = await jobs.stop();
            });
            disposalPhase = "disconnecting MCP servers";
            const disconnected = await attempt(() => liveMcp.manager.disconnectAll());
            disposalPhase = "disposing the engine";
            const engineDisposed = await attempt(() => liveEngine.dispose());
            const storeClosed = await attempt(() => owned?.close());
            const failure = disconnected ?? engineDisposed ?? storeClosed;
            if (failure) {
                // Leave the phase naming the step that failed, for the shutdown log.
                disposalPhase =
                    disconnected === undefined
                        ? "disposing the engine"
                        : "disconnecting MCP servers";
                throw failure.error;
            }
            if (stopFailed || !jobsStopped) {
                disposalPhase = "stopping background jobs";
                throw (
                    stopFailed?.error ??
                    new PicoSessionError(
                        `A background job's processes were still running ${STOP_GRACE_MS}ms after Pico stopped them.`,
                    )
                );
            }
            disposalPhase = undefined;
        },
    };
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
 * Opens Pico's credentials, reporting a failure as the session failure it is. The vault
 * releases whatever it opened before throwing, so nothing is left behind to close here.
 */
async function attemptOpen(open: () => Promise<PicoCredentials>): Promise<PicoCredentials> {
    try {
        return await open();
    } catch (error) {
        throw error instanceof PicoSessionError
            ? error
            : new PicoSessionError(describeCause(error));
    }
}

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
            `Pico could not use the credentials for ${named}: no credential Pico has selected for ${model.provider} can serve a request. ` +
                "Select one with `pico providers update`, and check it with `pico credentials get`.",
        );
    }
}

/**
 * The model and thinking level a saved default names, refusing one the catalog lacks or a level
 * the model does not offer: Pico never starts a session on a model the user did not choose.
 */
async function savedDefaultChoice(
    registry: ModelRegistry,
    saved: SavedDefault,
): Promise<{ model: Model<Api>; thinkingLevel: ConfiguredThinkingLevel }> {
    const model = await findCatalogModel(registry, saved.defaultModel);
    if (!model) {
        throw new PicoSessionError(
            `Pico's default model ${saved.defaultModel} is not available: no model with usable credentials has that name. ` +
                "Choose another default with `pico settings update`, then start a new session.",
        );
    }
    const thinkingLevel = offersThinking(model, saved.defaultThinking)
        ? parseConfiguredThinkingLevel(saved.defaultThinking)
        : undefined;
    if (!thinkingLevel) {
        const offered = thinkingChoices(model).map(choice => choice.value);
        throw new PicoSessionError(
            `Pico's default thinking level ${saved.defaultThinking} is not one ${saved.defaultModel} offers (${offered.join(", ")}). ` +
                "Choose another default with `pico settings update`, then start a new session.",
        );
    }
    return { model, thinkingLevel };
}
