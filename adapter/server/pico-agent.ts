// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { AgentApp, InitializeResponse, McpServerStdio } from "@agentclientprotocol/sdk";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent";

import { agent } from "@agentclientprotocol/sdk";

import type { PicoSession } from "../engine/pico-session.ts";

import { promptText } from "./prompt-content.ts";
import { SessionRegistry } from "./session-registry.ts";

export type PicoSessionFactory = (
    cwd: string,
    mcpServers: McpServerStdio[],
    sessionManager: SessionManager,
) => Promise<PicoSession>;

export interface PicoAgentOptions {
    /** Creates the engine session behind one ACP session. */
    createSession: PicoSessionFactory;
    /** Reported as `agentInfo.version`. */
    version: string;
    dataDir: string;
}

/**
 * The teardown a closed connection started.
 *
 * `outstanding` names the steps that have not finished, so a caller that gives up
 * on `completed` can say what it was still waiting for.
 */
export interface PicoAgentShutdown {
    readonly completed: Promise<void>;
    outstanding(): string[];
}

const shutdowns = new WeakMap<AgentApp, PicoAgentShutdown>();

const NOTHING_TO_DO: PicoAgentShutdown = { completed: Promise.resolve(), outstanding: () => [] };

export function picoAgentShutdown(app: AgentApp): PicoAgentShutdown {
    return shutdowns.get(app) ?? NOTHING_TO_DO;
}

/** One app serves one stdio connection: the client Sesh launches it for. */
export function createPicoAgent(options: PicoAgentOptions): AgentApp {
    let registry: SessionRegistry | undefined;
    const app = agent({ name: "pico" });
    app.onConnect(connection => {
        const connected = new SessionRegistry(options, connection.client);
        registry = connected;
        connection.signal.addEventListener("abort", () => connected.stopAdmission());
        shutdowns.set(app, {
            completed: connection.closed.then(() => connected.dispose()),
            outstanding: () => connected.outstanding(),
        });
    });

    app.onRequest("initialize", (): InitializeResponse => ({
        protocolVersion: 1,
        agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            mcpCapabilities: { http: false, sse: false },
            sessionCapabilities: { list: {}, resume: {} },
        },
        authMethods: [],
        agentInfo: { name: "pico", title: "Pico", version: options.version },
    }));
    app.onRequest("session/new", ({ params, signal }) => registry!.start(params, signal));
    app.onRequest("session/load", ({ params, signal }) => registry!.restore(params, signal, true));
    app.onRequest("session/resume", ({ params, signal }) =>
        registry!.restore(params, signal, false),
    );
    app.onRequest("session/list", ({ params }) => registry!.list(params));
    app.onRequest("session/set_config_option", async ({ params }) => ({
        configOptions: await registry!
            .get(params.sessionId)
            .setConfigOption(params.configId, params.value),
    }));
    app.onRequest("session/prompt", async ({ params }) => ({
        stopReason: await registry!.get(params.sessionId).prompt(promptText(params.prompt)),
    }));
    app.onNotification("session/cancel", ({ params }) => registry!.cancel(params.sessionId));
    return app;
}
