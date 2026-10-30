// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { AgentContext, StopReason } from "@agentclientprotocol/sdk";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";

import { RequestError } from "@agentclientprotocol/sdk";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent";

import type { PicoSession } from "../engine/pico-session.ts";

import { SessionEventMapper } from "../events/session-event-mapper.ts";
import { UpdateQueue } from "./update-queue.ts";

/** How long a cancellation may take to stop the engine before Pico gives up on the session. */
const ABORT_GRACE_MS = 5_000;

const CLOSED_AFTER_FAILED_CANCELLATION =
    "This session was closed after a cancellation could not stop it. Start a new session.";

type AbortOutcome = "stopped" | "rejected" | "expired";

interface Turn {
    cancelled: boolean;
    failure?: unknown;
    /** The engine's answer to this turn; assigned as soon as the turn starts. */
    enginePrompt?: Promise<void>;
    /** The bounded `abort()` a cancellation issued; shutdown waits for this alone. */
    aborted?: Promise<AbortOutcome>;
    /** The cancellation in flight. The turn stays reserved until it settles. */
    cancellation?: Promise<void>;
    /** Resolves when Pico stops waiting for the engine, because the session was closed. */
    readonly abandoned: PromiseWithResolvers<void>;
}

/** One ACP session: its engine session, its update queue, and the turn running on it. */
export class SessionRuntime {
    readonly #session: PicoSession;
    readonly #queue: UpdateQueue;
    #turn: Turn | undefined;
    #closedReason: string | undefined;
    #disposal: Promise<void> | undefined;

    constructor(sessionId: string, session: PicoSession, client: AgentContext) {
        this.#session = session;
        this.#queue = new UpdateQueue(client, sessionId);
    }

    async prompt(text: string): Promise<StopReason> {
        if (this.#closedReason) throw RequestError.internalError(undefined, this.#closedReason);
        if (this.#turn) {
            throw RequestError.invalidParams(
                undefined,
                "a turn is already running in this session",
            );
        }

        const turn: Turn = { cancelled: false, abandoned: Promise.withResolvers<void>() };
        this.#turn = turn;

        const mapper = new SessionEventMapper(this.#session);
        let lastAssistantMessage: AssistantMessage | undefined;
        const unsubscribe = this.#session.engine.subscribe(event => {
            if (event.type === "message_end" && event.message.role === "assistant") {
                lastAssistantMessage = event.message;
            }
            for (const update of mapper.map(event)) this.#queue.push(update);
        });

        try {
            turn.enginePrompt = this.#session.engine.prompt(text).then(
                () => undefined,
                (error: unknown) => {
                    turn.failure = error;
                },
            );
            await Promise.race([turn.enginePrompt, turn.abandoned.promise]);
        } finally {
            // The engine can answer the prompt while an abort is still unwinding:
            // holding the turn until the cancellation settles keeps the next prompt
            // off a session this one may yet close, and keeps the updates the
            // unwinding produces on the stream.
            await turn.cancellation;
            unsubscribe();
            for (const update of mapper.closeOpenToolCalls()) this.#queue.push(update);
            // A cancel can still arrive while the last update is in flight, so the
            // turn is only free once nothing is draining and none is pending.
            let joined: Promise<void> | undefined;
            do {
                joined = turn.cancellation;
                await joined;
                await this.#queue.drained();
            } while (joined !== turn.cancellation);
            this.#turn = undefined;
        }

        if (turn.cancelled) return "cancelled";
        if (turn.failure !== undefined) {
            throw RequestError.internalError(undefined, describe(turn.failure));
        }
        return stopReasonOf(lastAssistantMessage);
    }

    /** Ignored unless a turn is running and this is the first cancel of that turn. */
    cancel(): void {
        const turn = this.#turn;
        if (!turn || turn.cancellation) return;
        turn.cancelled = true;
        const aborted = abortOutcome(
            this.#session.engine.abort({ reason: USER_INTERRUPT_LABEL }),
            ABORT_GRACE_MS,
        );
        turn.aborted = aborted;
        turn.cancellation = this.#settleCancellation(turn, aborted).catch((error: unknown) => {
            console.error(`pico: cancelling the turn failed: ${describe(error)}`);
        });
    }

    /**
     * Stops a running turn before the engine session and its MCP servers go away.
     *
     * Shutdown waits for the abort, not for the turn's own answer: the client that
     * asked for it is already gone.
     */
    async dispose(): Promise<void> {
        this.cancel();
        await this.#turn?.aborted;
        await this.#dispose();
    }

    async #settleCancellation(turn: Turn, aborted: Promise<AbortOutcome>): Promise<void> {
        const outcome = await aborted;
        if (outcome === "rejected") return this.#close(turn, "the engine rejected the abort");
        if (outcome === "expired") {
            return this.#close(turn, `the abort did not settle within ${ABORT_GRACE_MS}ms`);
        }
        // An accepted abort still has to end the turn; an engine stuck before its
        // next dispatch would otherwise leave the prompt unanswered forever.
        if (!(await settlesWithin(turn.enginePrompt, ABORT_GRACE_MS))) {
            this.#close(
                turn,
                `the turn did not end within ${ABORT_GRACE_MS}ms of an accepted abort`,
            );
        }
    }

    #close(turn: Turn, cause: string): void {
        this.#closedReason = CLOSED_AFTER_FAILED_CANCELLATION;
        console.error(`pico: ${cause}; closing the session`);
        turn.abandoned.resolve();
        // Disposal is off the cancelled response's path: a teardown that stalls must
        // not hold the answer back. Connection shutdown still waits for it.
        void this.#dispose().catch((error: unknown) => {
            console.error(`pico: disposing the closed session failed: ${describe(error)}`);
        });
    }

    /** The engine session is torn down once; every later caller awaits that work. */
    #dispose(): Promise<void> {
        this.#disposal ??= this.#session.dispose();
        return this.#disposal;
    }
}

function stopReasonOf(message: AssistantMessage | undefined): StopReason {
    if (!message) return "end_turn";
    switch (message.stopReason) {
        case "length":
            return "max_tokens";
        case "error":
            if (message.stopDetails?.type === "refusal") return "refusal";
            throw RequestError.internalError(
                undefined,
                message.errorMessage ?? "the engine ended the turn with an error",
            );
        case "aborted":
            // Pico's own cancellation never reaches here; this is the engine
            // stopping a turn nobody asked it to stop.
            throw RequestError.internalError(
                undefined,
                message.errorMessage ?? "the engine aborted the turn",
            );
        default:
            return "end_turn";
    }
}

function describe(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure);
}

async function abortOutcome(work: Promise<unknown>, ms: number): Promise<AbortOutcome> {
    const expiry = Promise.withResolvers<AbortOutcome>();
    const timer = setTimeout(() => expiry.resolve("expired"), ms);
    try {
        return await Promise.race([
            work.then(
                (): AbortOutcome => "stopped",
                (): AbortOutcome => "rejected",
            ),
            expiry.promise,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function settlesWithin(work: Promise<unknown> | undefined, ms: number): Promise<boolean> {
    if (!work) return true;
    const expiry = Promise.withResolvers<false>();
    const timer = setTimeout(() => expiry.resolve(false), ms);
    try {
        return await Promise.race([work.then(() => true), expiry.promise]);
    } finally {
        clearTimeout(timer);
    }
}
