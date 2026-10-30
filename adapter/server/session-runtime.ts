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

interface Turn {
    cancelled: boolean;
    cancelling: boolean;
    failure?: unknown;
    readonly abandoned: PromiseWithResolvers<void>;
}

/** One ACP session: its engine session, its update queue, and the turn running on it. */
export class SessionRuntime {
    readonly #session: PicoSession;
    readonly #queue: UpdateQueue;
    #turn: Turn | undefined;
    #closedReason: string | undefined;

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

        const turn: Turn = {
            cancelled: false,
            cancelling: false,
            abandoned: Promise.withResolvers<void>(),
        };
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
            await Promise.race([
                this.#session.engine.prompt(text).catch((error: unknown) => {
                    turn.failure = error;
                }),
                turn.abandoned.promise,
            ]);
        } finally {
            unsubscribe();
            for (const update of mapper.closeOpenToolCalls()) this.#queue.push(update);
            this.#turn = undefined;
            await this.#queue.drained();
        }

        if (turn.cancelled) return "cancelled";
        if (turn.failure !== undefined)
            throw RequestError.internalError(undefined, describe(turn.failure));
        return stopReasonOf(lastAssistantMessage);
    }

    /** Ignored unless a turn is running and this is the first cancel of that turn. */
    cancel(): void {
        const turn = this.#turn;
        if (!turn || turn.cancelling) return;
        turn.cancelling = true;
        turn.cancelled = true;
        void this.#abort(turn);
    }

    async dispose(): Promise<void> {
        await this.#session.dispose();
    }

    async #abort(turn: Turn): Promise<void> {
        if (
            await settlesWithin(
                this.#session.engine.abort({ reason: USER_INTERRUPT_LABEL }),
                ABORT_GRACE_MS,
            )
        ) {
            return;
        }
        this.#closedReason = CLOSED_AFTER_FAILED_CANCELLATION;
        console.error(
            `pico: abort did not settle within ${ABORT_GRACE_MS}ms; disposing the session`,
        );
        turn.abandoned.resolve();
        await this.#session.dispose();
    }
}

function stopReasonOf(message: AssistantMessage | undefined): StopReason {
    if (!message) return "end_turn";
    if (message.stopReason === "length") return "max_tokens";
    if (message.stopReason !== "error") return "end_turn";
    if (message.stopDetails?.type === "refusal") return "refusal";
    throw RequestError.internalError(
        undefined,
        message.errorMessage ?? "the engine ended the turn with an error",
    );
}

function describe(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure);
}

async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
    const expiry = Promise.withResolvers<false>();
    const timer = setTimeout(() => expiry.resolve(false), ms);
    try {
        return await Promise.race([
            work.then(
                () => true,
                () => true,
            ),
            expiry.promise,
        ]);
    } finally {
        clearTimeout(timer);
    }
}
