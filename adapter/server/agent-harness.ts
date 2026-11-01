import type {
    AgentApp,
    ClientContext,
    InitializeResponse,
    SessionNotification,
    SessionUpdate,
} from "@agentclientprotocol/sdk";

import { client, RequestError } from "@agentclientprotocol/sdk";

import type { PicoAgentOptions } from "./pico-agent.ts";

import { temporaryDataDir } from "./engine-harness.ts";
import { createPicoAgent } from "./pico-agent.ts";

/** A client connected in process to a Pico agent, recording everything the agent sends it. */
export interface ConnectedClient {
    /** The agent under test, for `picoAgentShutdown`. */
    readonly app: AgentApp;
    readonly agent: ClientContext;
    readonly notifications: SessionNotification[];
    /** Permission requests the agent sent; Pico must never send any. */
    readonly permissionRequests: unknown[];
    updatesFor(sessionId: string): SessionUpdate[];
    /** Resolves with the first update of a session that matches, past or future. */
    waitForUpdate(
        sessionId: string,
        matches: (update: SessionUpdate) => boolean,
    ): Promise<SessionUpdate>;
    initialize(protocolVersion?: number): Promise<InitializeResponse>;
    close(): Promise<void>;
}

export function connectPicoAgent(
    options: Omit<PicoAgentOptions, "dataDir"> & { dataDir?: string },
): ConnectedClient {
    const notifications: SessionNotification[] = [];
    const permissionRequests: unknown[] = [];
    const waiters: ((notification: SessionNotification) => void)[] = [];

    const clientApp = client({ name: "pico-test-client" })
        .onNotification("session/update", ({ params }) => {
            notifications.push(params);
            for (const waiter of waiters.splice(0)) waiter(params);
        })
        .onRequest("session/request_permission", ({ params }) => {
            permissionRequests.push(params);
            throw new Error("Pico must not ask the client for permission");
        });

    const app = createPicoAgent({ ...options, dataDir: options.dataDir ?? temporaryDataDir() });
    const connection = clientApp.connect(app);

    return {
        app,
        agent: connection.agent,
        notifications,
        permissionRequests,
        updatesFor: sessionId =>
            notifications.filter(entry => entry.sessionId === sessionId).map(entry => entry.update),
        waitForUpdate: (sessionId, matches) => {
            const seen = notifications.find(
                entry => entry.sessionId === sessionId && matches(entry.update),
            );
            if (seen) return Promise.resolve(seen.update);
            const { promise, resolve } = Promise.withResolvers<SessionUpdate>();
            const listen = (notification: SessionNotification) => {
                if (notification.sessionId === sessionId && matches(notification.update))
                    resolve(notification.update);
                else waiters.push(listen);
            };
            waiters.push(listen);
            return promise;
        },
        initialize: (protocolVersion = 1) =>
            connection.agent.request("initialize", { protocolVersion, clientCapabilities: {} }),
        close: async () => {
            connection.close();
            await connection.closed;
        },
    };
}

/** Awaits a request expected to fail and returns its JSON-RPC error. */
export async function requestError(pending: Promise<unknown>): Promise<RequestError> {
    try {
        await pending;
    } catch (error) {
        if (error instanceof RequestError) return error;
        throw error;
    }
    throw new Error("expected the request to fail, but it succeeded");
}
/** The assistant text a turn streamed, joined in arrival order. */
export function assistantText(updates: SessionUpdate[]): string {
    return updates
        .filter(update => update.sessionUpdate === "agent_message_chunk")
        .map(update => (update.content.type === "text" ? update.content.text : ""))
        .join("");
}

export const INVALID_PARAMS = -32602;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;
