import type {
    AgentContext,
    LoadSessionRequest,
    McpServer,
    McpServerStdio,
    NewSessionRequest,
    ResumeSessionRequest,
} from "@agentclientprotocol/sdk";

import { RequestError } from "@agentclientprotocol/sdk";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";
import type { StoredSession } from "../history/session-store.ts";
import type { PicoAgentOptions } from "./pico-agent.ts";

import { attempt } from "../engine/errors.ts";
import { SessionStore, SessionStoreError } from "../history/session-store.ts";
import { requireProject } from "../history/storage-paths.ts";
import { SessionRuntime } from "./session-runtime.ts";

export class SessionRegistry {
    readonly #store: SessionStore;
    readonly #options: PicoAgentOptions;
    readonly #client: AgentContext;
    readonly #sessions = new Map<string, SessionRuntime>();
    readonly #opening = new Set<string>();
    readonly #starting = new Set<Promise<void>>();
    readonly #cleanupFailures: unknown[] = [];
    #closed = false;

    constructor(options: PicoAgentOptions, client: AgentContext) {
        this.#options = options;
        this.#client = client;
        this.#store = new SessionStore(options.dataDir);
    }

    stopAdmission(): void {
        this.#closed = true;
    }

    start(params: NewSessionRequest, signal: AbortSignal) {
        return this.#track(async () => {
            this.#requireOpen(signal);
            const servers = requestServers(params.cwd, params.mcpServers);
            const stored = await this.#store.create(params.cwd);
            const runtime = await this.#attach(stored, servers, signal, false, true);
            return { sessionId: stored.sessionId, configOptions: runtime.configOptions() };
        });
    }

    restore(
        params: LoadSessionRequest | ResumeSessionRequest,
        signal: AbortSignal,
        replay: boolean,
    ) {
        return this.#track(async () => {
            this.#requireOpen(signal);
            const servers = requestServers(params.cwd, params.mcpServers ?? []);
            const previous = this.#sessions.get(params.sessionId);
            if (this.#opening.has(params.sessionId) || previous?.busy) {
                throw RequestError.invalidParams(
                    undefined,
                    `session "${params.sessionId}" is busy or closing`,
                );
            }
            if (previous && requireProject(params.cwd) !== previous.cwd) {
                throw RequestError.invalidParams(
                    undefined,
                    `session "${params.sessionId}" belongs to ${previous.cwd}, not "${params.cwd}"`,
                );
            }
            this.#opening.add(params.sessionId);
            try {
                if (previous) {
                    const failure = await attempt(() => previous.dispose());
                    if (failure) {
                        this.#cleanupFailures.push(failure.error);
                        throw failure.error;
                    }
                    this.#sessions.delete(params.sessionId);
                    this.#requireOpen(signal);
                }
                const stored = await this.#store.open(params.sessionId, params.cwd);
                const runtime = await this.#attach(stored, servers, signal, replay, false);
                return { configOptions: runtime.configOptions() };
            } finally {
                this.#opening.delete(params.sessionId);
            }
        });
    }

    async list(params: { cwd?: string | null; cursor?: string | null }) {
        try {
            this.#requireOpen();
            await Promise.all(
                [...this.#sessions.values()].map(runtime => runtime.flushPersistence()),
            );
            return await this.#store.list(params);
        } catch (error) {
            throw protocolError(error);
        }
    }

    get(sessionId: string): SessionRuntime {
        if (this.#opening.has(sessionId)) {
            throw RequestError.invalidParams(
                undefined,
                `session "${sessionId}" is starting or replaying`,
            );
        }
        const runtime = this.#sessions.get(sessionId);
        if (!runtime) throw RequestError.invalidParams(undefined, `unknown session "${sessionId}"`);
        return runtime;
    }

    cancel(sessionId: string): void {
        this.#sessions.get(sessionId)?.cancel();
    }

    async dispose(): Promise<void> {
        this.stopAdmission();
        const disposals = [...this.#sessions.values()].map(runtime => runtime.dispose());
        const outcomes = await Promise.allSettled([...this.#starting, ...disposals]);
        const failure = outcomes.find(outcome => outcome.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        if (this.#cleanupFailures.length > 0) throw this.#cleanupFailures[0];
        this.#sessions.clear();
    }

    outstanding(): string[] {
        const steps =
            this.#starting.size > 0
                ? ["waiting for sessions that have not finished starting or replaying"]
                : [];
        for (const runtime of this.#sessions.values()) {
            if (runtime.outstandingStep) steps.push(runtime.outstandingStep);
        }
        return steps;
    }

    #track<T>(operation: () => Promise<T>): Promise<T> {
        const work = operation().catch((error: unknown) => {
            throw protocolError(error);
        });
        const settled = work.then(
            () => undefined,
            () => undefined,
        );
        this.#starting.add(settled);
        void settled.finally(() => this.#starting.delete(settled));
        return work;
    }

    async #attach(
        stored: StoredSession,
        servers: McpServerStdio[],
        signal: AbortSignal,
        replay: boolean,
        fresh: boolean,
    ): Promise<SessionRuntime> {
        let session: PicoSession | undefined;
        let runtime: SessionRuntime | undefined;
        try {
            this.#requireOpen(signal);
            session = await this.#options.createSession(stored.cwd, servers, stored.manager);
            this.#requireOpen(signal);
            runtime = new SessionRuntime(stored.sessionId, session, this.#client, stored);
            await runtime.flushPersistence();
            if (replay) await runtime.replay(signal);
            this.#requireOpen(signal);
            this.#sessions.set(stored.sessionId, runtime);
            return runtime;
        } catch (error) {
            const sessionDisposed = await attempt(() =>
                runtime ? runtime.dispose() : session?.dispose(),
            );
            const historyClosed = runtime ? undefined : await attempt(() => stored.close());
            const discarded = fresh ? await attempt(() => stored.discard()) : undefined;
            const failure = sessionDisposed ?? historyClosed ?? discarded;
            if (failure) {
                this.#cleanupFailures.push(failure.error);
                console.error(
                    `pico: failed to release session ${stored.sessionId}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`,
                );
            }
            throw error;
        }
    }

    #requireOpen(signal?: AbortSignal): void {
        if (this.#closed || signal?.aborted) {
            throw RequestError.requestCancelled(
                undefined,
                "the connection closed while the session was starting or replaying",
            );
        }
    }
}

function requestServers(cwd: string, servers: McpServer[]): McpServerStdio[] {
    if (!isAbsolute(cwd))
        throw RequestError.invalidParams(
            undefined,
            `cwd must be an absolute path, but the request sent "${cwd}"`,
        );
    let directory = false;
    try {
        directory = statSync(cwd).isDirectory();
    } catch {}
    if (!directory)
        throw RequestError.invalidParams(undefined, `cwd "${cwd}" is not an existing directory`);
    return servers.map(server => {
        if ("type" in server && (server.type === "http" || server.type === "sse")) {
            throw RequestError.invalidParams(
                undefined,
                `MCP server "${server.name}" uses the ${server.type} transport; only stdio MCP servers are supported`,
            );
        }
        return server;
    });
}

function protocolError(error: unknown): RequestError {
    if (error instanceof RequestError) return error;
    if (error instanceof SessionStoreError) {
        if (error.kind === "not-found" && error.sessionId)
            return RequestError.sessionNotFound(error.sessionId);
        if (error.kind === "invalid" || error.kind === "busy")
            return RequestError.invalidParams(undefined, error.message);
    }
    return RequestError.internalError(
        undefined,
        error instanceof Error ? error.message : String(error),
    );
}
