// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type {
    AgentApp,
    AgentContext,
    InitializeResponse,
    McpServer,
    McpServerStdio,
    NewSessionRequest,
    NewSessionResponse,
} from "@agentclientprotocol/sdk";

import { agent, RequestError } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";

import { promptText } from "./prompt-content.ts";
import { SessionRuntime } from "./session-runtime.ts";

export type PicoSessionFactory = (
    cwd: string,
    mcpServers: McpServerStdio[],
) => Promise<PicoSession>;

export interface PicoAgentOptions {
    /** Creates the engine session behind one ACP session. */
    createSession: PicoSessionFactory;
    /** Reported as `agentInfo.version`. */
    version: string;
}

const shutdowns = new WeakMap<AgentApp, Promise<void>>();

/** Resolves once every session the app's connection opened has been disposed. */
export function picoAgentShutdown(app: AgentApp): Promise<void> {
    return shutdowns.get(app) ?? Promise.resolve();
}

/** One app serves one stdio connection: the client Sesh launches it for. */
export function createPicoAgent(options: PicoAgentOptions): AgentApp {
    const sessions = new Map<string, SessionRuntime>();
    /** Session creations still running; shutdown waits for each to land or dispose itself. */
    const starting = new Set<Promise<void>>();
    let client: AgentContext | undefined;
    let closed = false;

    const app = agent({ name: "pico" });

    app.onConnect(connection => {
        client = connection.client;
        // The signal aborts as the connection tears down, before `closed` settles:
        // a `session/new` still inside its factory has to see that straight away.
        connection.signal.addEventListener("abort", () => {
            closed = true;
        });
        shutdowns.set(
            app,
            connection.closed.then(async () => {
                closed = true;
                await Promise.all(starting);
                await Promise.all([...sessions.values()].map(runtime => runtime.dispose()));
                sessions.clear();
            }),
        );
    });

    app.onRequest("initialize", (): InitializeResponse => ({
        protocolVersion: 1,
        agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            mcpCapabilities: { http: false, sse: false },
        },
        authMethods: [],
        agentInfo: { name: "pico", title: "Pico", version: options.version },
    }));

    app.onRequest("session/new", ({ params, signal }): Promise<NewSessionResponse> => {
        const started = startSession(params, signal);
        const settled = started.then(
            () => undefined,
            () => undefined,
        );
        starting.add(settled);
        void settled.finally(() => starting.delete(settled));
        return started;
    });

    async function startSession(
        params: NewSessionRequest,
        signal: AbortSignal,
    ): Promise<NewSessionResponse> {
        requireExistingDirectory(params.cwd);
        const mcpServers = params.mcpServers.map(requireStdioTransport);
        const session = await createSession(options.createSession, params.cwd, mcpServers);
        if (closed || signal.aborted) {
            // Shutdown already walked the registry: registering now would leave this
            // session, and the MCP servers it started, running with nobody to stop them.
            await session.dispose();
            throw RequestError.internalError(
                undefined,
                "the connection closed while the session was starting",
            );
        }
        const sessionId = randomUUID();
        sessions.set(sessionId, new SessionRuntime(sessionId, session, requireClient(client)));
        return { sessionId };
    }

    app.onRequest("session/prompt", async ({ params }) => {
        const runtime = sessions.get(params.sessionId);
        if (!runtime) {
            throw RequestError.invalidParams(undefined, `unknown session "${params.sessionId}"`);
        }
        return { stopReason: await runtime.prompt(promptText(params.prompt)) };
    });

    app.onNotification("session/cancel", ({ params }) => {
        sessions.get(params.sessionId)?.cancel();
    });

    return app;
}

function requireExistingDirectory(cwd: string): void {
    if (!isAbsolute(cwd)) {
        throw RequestError.invalidParams(
            undefined,
            `cwd must be an absolute path, but the request sent "${cwd}"`,
        );
    }
    if (!isDirectory(cwd)) {
        throw RequestError.invalidParams(undefined, `cwd "${cwd}" is not an existing directory`);
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function requireStdioTransport(server: McpServer): McpServerStdio {
    if ("type" in server && (server.type === "http" || server.type === "sse")) {
        throw RequestError.invalidParams(
            undefined,
            `MCP server "${server.name}" uses the ${server.type} transport; only stdio MCP servers are supported`,
        );
    }
    return server;
}

async function createSession(
    factory: PicoSessionFactory,
    cwd: string,
    mcpServers: McpServerStdio[],
): Promise<PicoSession> {
    try {
        return await factory(cwd, mcpServers);
    } catch (error) {
        if (error instanceof RequestError) throw error;
        throw RequestError.internalError(
            undefined,
            error instanceof Error ? error.message : String(error),
        );
    }
}

function requireClient(client: AgentContext | undefined): AgentContext {
    if (!client)
        throw RequestError.internalError(undefined, "the agent is not connected to a client");
    return client;
}
