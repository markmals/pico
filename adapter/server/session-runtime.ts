// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type {
    AgentContext,
    SessionConfigOption,
    SessionUpdate,
    StopReason,
} from "@agentclientprotocol/sdk";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";

import { RequestError } from "@agentclientprotocol/sdk";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent";

import type { PicoSession } from "../engine/pico-session.ts";
import type { ToolPresentation } from "../events/tool-presentation.ts";
import type { StoredSession } from "../history/session-store.ts";

import { attempt } from "../engine/errors.ts";
import { childWorktreeUpdates } from "../events/child-worktree-updates.ts";
import { replayHistory } from "../events/history-replay.ts";
import { SessionEventMapper } from "../events/session-event-mapper.ts";
import { PlanReporter } from "../events/todo-plan.ts";
import { readToolPresentations, recordToolPresentation } from "../events/tool-presentation.ts";
import { applyConfigOption, configOptionsOf } from "./config-options.ts";
import { UpdateQueue } from "./update-queue.ts";

/** How long a cancellation may take to stop the engine before Pico gives up on the session. */
const ABORT_GRACE_MS = 5_000;

const CLOSED_AFTER_FAILED_CANCELLATION =
    "This session was closed after a cancellation could not stop it. Start a new session.";

const CLOSED_AFTER_UNSTOPPABLE_JOBS =
    "This session was closed after its background jobs could not be stopped. Start a new session.";

type AbortOutcome = "stopped" | "rejected" | "expired";

interface Turn {
    failure?: unknown;
    /** The engine's answer to this turn; assigned as soon as the turn starts. */
    enginePrompt?: Promise<void>;
    /** The bounded `abort()` a cancellation issued; shutdown waits for this alone. */
    aborted?: Promise<AbortOutcome>;
    /** Set the moment a cancel is accepted: the turn is cancelled and stays reserved until this settles. */
    cancellation?: Promise<void>;
    /**
     * Set once the turn's background jobs are being stopped, by a cancellation or a failure; false
     * when a job's processes would not stop (proposal.0008).
     */
    jobsStopped?: Promise<boolean>;
    /** Resolves when Pico stops waiting for the engine, because the session was closed. */
    readonly abandoned: PromiseWithResolvers<void>;
}

/** One ACP session: its engine session, its update queue, and the turn running on it. */
export class SessionRuntime {
    readonly #sessionId: string;
    readonly #session: PicoSession;
    readonly #queue: UpdateQueue;
    readonly #history: StoredSession | undefined;
    readonly #presentations: ReadonlyMap<string, ToolPresentation>;
    readonly #stopWatchingPersistence: () => void;
    #turn: Turn | undefined;
    #closedReason: string | undefined;
    #disposal: Promise<void> | undefined;
    #step: "stopping the turn" | "disposing" | undefined;
    /** Config changes in progress; the engine's change events during one are settled by its outcome. */
    #applyingConfigOption = 0;
    /** The menus as the client last received them, so each change reaches it once. */
    #reportedOptions: string;
    readonly #stopWatchingModel: () => void;
    /** The plan this attachment's client last received. */
    readonly #plan = new PlanReporter();

    constructor(
        sessionId: string,
        session: PicoSession,
        client: AgentContext,
        history?: StoredSession,
    ) {
        this.#sessionId = sessionId;
        this.#session = session;
        this.#queue = new UpdateQueue(client, sessionId);
        this.#reportedOptions = JSON.stringify(this.configOptions());
        this.#history = history;
        this.#presentations = readToolPresentations(history?.manager.getBranch() ?? []);
        this.#stopWatchingPersistence =
            history?.onFailure(error => {
                this.#closedReason = `Session history could not be saved: ${error.message}`;
                this.cancel();
            }) ?? (() => {});
        // The engine can change the model or thinking level itself (a clamp, a retry
        // fallback); the client's menus have to follow, through the ordered queue.
        this.#stopWatchingModel = session.engine.subscribe(event => {
            if (event.type !== "model_changed" && event.type !== "thinking_level_changed") return;
            if (this.#applyingConfigOption > 0) return;
            this.#reportChangedOptions();
        });
    }

    get cwd(): string {
        return this.#session.cwd;
    }

    get busy(): boolean {
        return (
            this.#turn !== undefined ||
            this.#applyingConfigOption > 0 ||
            this.#disposal !== undefined
        );
    }

    /** The session's model and thinking menus as they stand now. */
    configOptions(): SessionConfigOption[] {
        return configOptionsOf(this.#session.engine);
    }

    async flushPersistence(): Promise<void> {
        try {
            await this.#history?.flush();
        } catch (error) {
            this.#closedReason = `Session history could not be saved: ${describe(error)}`;
            throw RequestError.internalError(undefined, this.#closedReason);
        }
    }

    async replay(signal: AbortSignal): Promise<void> {
        if (!this.#history) throw new Error("A session without history cannot be loaded");
        for (const update of replayHistory(
            this.#history.manager,
            this.#session.cwd,
            this.#presentations,
        )) {
            if (signal.aborted) throw RequestError.requestCancelled();
            this.#queue.push(update);
            await this.#queue.drained();
        }
        if (signal.aborted) throw RequestError.requestCancelled();
    }

    /** Sends the engine's current todo list, whatever the client holds: a reopened client's copy may be stale. */
    async sendCurrentPlan(): Promise<void> {
        this.#queue.push(this.#plan.current(this.#session.engine.getTodoPhases()));
        await this.#queue.drained();
    }

    /** Sends the engine's todo list when it differs from the plan the client holds. */
    #reportPlanChanges(): void {
        for (const update of this.#plan.changes(this.#session.engine.getTodoPhases())) {
            this.#queue.push(update);
        }
    }

    #publish(update: SessionUpdate): void {
        if (this.#history) recordToolPresentation(this.#history.manager, update);
        this.#queue.push(update);
    }

    /** Applies a client's menu choice and answers with the menus that result. */
    async setConfigOption(
        configId: string,
        value: string | boolean,
    ): Promise<SessionConfigOption[]> {
        this.#requireOpen();
        this.#applyingConfigOption += 1;
        let applied = false;
        try {
            await this.flushPersistence();
            this.#requireOpen();
            await applyConfigOption(this.#session, configId, value);
            await this.flushPersistence();
            applied = true;
        } finally {
            this.#applyingConfigOption -= 1;
            // A refused choice has no response to carry what the engine changed
            // on its own meanwhile, so that change goes out as an update.
            if (!applied) this.#reportChangedOptions();
        }
        const options = this.configOptions();
        this.#reportedOptions = JSON.stringify(options);
        return options;
    }

    #reportChangedOptions(): void {
        const options = this.configOptions();
        const serialized = JSON.stringify(options);
        if (serialized === this.#reportedOptions) return;
        this.#reportedOptions = serialized;
        this.#queue.push({ sessionUpdate: "config_option_update", configOptions: options });
    }

    /**
     * The teardown step still running, for the shutdown diagnostic.
     *
     * While the session is being disposed it reports the phase it is on; Pico only
     * names the whole teardown when the session reports no phase.
     */
    get outstandingStep(): string | undefined {
        if (this.#step === "stopping the turn") {
            return `stopping the turn running in session ${this.#sessionId}`;
        }
        if (this.#step !== "disposing") return undefined;
        const phase = this.#session.disposalPhase;
        return phase
            ? `session ${this.#sessionId}: ${phase}`
            : `disposing session ${this.#sessionId} and the MCP servers it started`;
    }

    async prompt(text: string): Promise<StopReason> {
        this.#requireOpen();
        if (this.#turn) {
            throw RequestError.invalidParams(
                undefined,
                "a turn is already running in this session",
            );
        }

        const turn: Turn = { abandoned: Promise.withResolvers<void>() };
        this.#turn = turn;

        const mapper = new SessionEventMapper(this.#session);
        let lastAssistantMessage: AssistantMessage | undefined;
        const unsubscribe = this.#session.engine.subscribe(event => {
            if (event.type === "message_end" && event.message.role === "assistant") {
                lastAssistantMessage = event.message;
            }
            for (const update of mapper.map(event)) this.#publish(update);
            if (event.type === "tool_execution_end" && event.toolName === "todo") {
                this.#reportPlanChanges();
            }
            // A run that fails ends the turn, so the jobs it leaves running go with it.
            if (event.type === "agent_end" && !turn.cancellation && failed(lastAssistantMessage)) {
                void this.#stopJobs(turn);
            }
        });

        try {
            await this.flushPersistence();
            if (turn.cancellation) return "cancelled";
            this.#requireOpen();
            await this.#cleanUpChildWorktrees();
            if (turn.cancellation) return "cancelled";
            turn.enginePrompt = this.#runEngine(turn, text).then(
                () => undefined,
                (error: unknown) => {
                    turn.failure = error;
                    void this.#stopJobs(turn);
                },
            );
            await Promise.race([turn.enginePrompt, turn.abandoned.promise]);
        } finally {
            // The engine can answer the prompt while an abort is still unwinding:
            // holding the turn until the cancellation settles keeps the next prompt
            // off a session this one may yet close, and keeps the updates the
            // unwinding produces on the stream.
            await turn.cancellation;
            // A failed turn answers only once its jobs are gone; a cancelled one settled that above.
            if (!turn.cancellation && turn.jobsStopped && !(await turn.jobsStopped)) {
                this.#close(
                    turn,
                    "a failed turn's background jobs did not stop",
                    CLOSED_AFTER_UNSTOPPABLE_JOBS,
                );
            }
            // A write the engine started can outlive the answer: releasing the turn
            // now would let it overwrite what the next turn writes to the same file.
            // A cancellation bounds the same wait, and closing the session ends it.
            if (!this.#closedReason) {
                await Promise.race([this.#session.writesSettled(), turn.abandoned.promise]);
            }
            unsubscribe();
            for (const update of mapper.closeOpenToolCalls()) this.#publish(update);
            // A cancellation can close a todo call whose change the engine still kept.
            this.#reportPlanChanges();
            if (!this.#closedReason) await this.#cleanUpChildWorktrees();
            // A cancel can still arrive while the last update is in flight, so the
            // turn is only free once nothing is draining and none is pending.
            let joined: Promise<void> | undefined;
            try {
                do {
                    joined = turn.cancellation;
                    await joined;
                    await this.#queue.drained();
                    await this.flushPersistence();
                } while (joined !== turn.cancellation);
            } finally {
                this.#turn = undefined;
            }
        }

        if (this.#history?.failure)
            throw RequestError.internalError(undefined, this.#history.failure.message);
        if (turn.cancellation) return "cancelled";
        if (turn.failure !== undefined) {
            throw RequestError.internalError(undefined, describe(turn.failure));
        }
        return stopReasonOf(lastAssistantMessage);
    }

    /** Ignored unless a turn is running and this is the first cancel of that turn. */
    cancel(): void {
        const turn = this.#turn;
        if (!turn || turn.cancellation) return;
        const aborted = abortOutcome(
            this.#session.engine.abort({ reason: USER_INTERRUPT_LABEL }),
            ABORT_GRACE_MS,
        );
        turn.aborted = aborted;
        const jobsStopped = this.#stopJobs(turn);
        turn.cancellation = this.#settleCancellation(turn, aborted, jobsStopped).catch(
            (error: unknown) => {
                console.error(`pico: cancelling the turn failed: ${describe(error)}`);
            },
        );
    }

    /** Runs the engine, then holds the turn for its background jobs and the runs they wake. */
    async #runEngine(turn: Turn, text: string): Promise<void> {
        await this.#session.engine.prompt(text);
        await this.#session.settleBackgroundWork(() => turn.jobsStopped !== undefined);
    }

    /** Stops the turn's background jobs once; every later caller shares that outcome. */
    #stopJobs(turn: Turn): Promise<boolean> {
        turn.jobsStopped ??= this.#stopBackgroundJobs();
        return turn.jobsStopped;
    }

    /** A stop that fails has not shown the jobs stopped, so it counts as one that could not stop them. */
    #stopBackgroundJobs(): Promise<boolean> {
        return this.#session.stopBackgroundJobs().catch((error: unknown) => {
            console.error(`pico: stopping background jobs failed: ${describe(error)}`);
            return false;
        });
    }

    /** Removes finished children's unchanged worktrees, each removal shown as a tool call (proposal.0010). */
    async #cleanUpChildWorktrees(): Promise<void> {
        const cleanup = await this.#session.cleanUpChildWorktrees().catch((error: unknown) => ({
            removals: [],
            failure: `Pico couldn't check its children's worktrees: ${describe(error)}`,
        }));
        for (const update of childWorktreeUpdates(cleanup)) this.#queue.push(update);
    }

    /**
     * Stops a running turn before the engine session and its MCP servers go away.
     *
     * Shutdown waits for the abort, not for the turn's own answer: the client that
     * asked for it is already gone.
     */
    async dispose(): Promise<void> {
        this.cancel();
        if (this.#turn?.aborted) {
            this.#step = "stopping the turn";
            await this.#turn.aborted;
        }
        this.#step = "disposing";
        if (!this.#closedReason && !this.#disposal) await this.#cleanUpChildWorktrees();
        try {
            await this.#dispose();
        } finally {
            this.#step = undefined;
        }
    }

    async #settleCancellation(
        turn: Turn,
        aborted: Promise<AbortOutcome>,
        jobsStopped: Promise<boolean>,
    ): Promise<void> {
        const outcome = await aborted;
        if (outcome === "rejected") return this.#close(turn, "the engine rejected the abort");
        if (outcome === "expired") {
            return this.#close(turn, `the abort did not settle within ${ABORT_GRACE_MS}ms`);
        }
        // An accepted abort still has to end the turn; an engine stuck before its
        // next dispatch would otherwise leave the prompt unanswered forever.
        if (!(await settlesWithin(turn.enginePrompt, ABORT_GRACE_MS))) {
            return this.#close(
                turn,
                `the turn did not end within ${ABORT_GRACE_MS}ms of an accepted abort`,
            );
        }
        // A job that ignores SIGTERM outlives its cancellation for a moment, and one can start while
        // the abort unwinds; the turn is not cancelled while any of their processes runs.
        if (!(await jobsStopped) || !(await this.#stopBackgroundJobs())) {
            return this.#close(
                turn,
                "a background job's processes were still running after the cancellation stopped it",
            );
        }
        // A write the cancelled turn started can still be on its way to disk. The
        // session cannot take another turn until it lands, or the next turn's file
        // is overwritten by the one this turn was told to stop.
        if (!(await settlesWithin(this.#session.writesSettled(), ABORT_GRACE_MS))) {
            this.#close(
                turn,
                `the files the turn was writing did not settle within ${ABORT_GRACE_MS}ms`,
            );
        }
    }

    #close(turn: Turn, cause: string, reason = CLOSED_AFTER_FAILED_CANCELLATION): void {
        this.#closedReason = reason;
        console.error(`pico: ${cause}; closing the session`);
        turn.abandoned.resolve();
        // Disposal is off the cancelled response's path: a teardown that stalls must
        // not hold the answer back. Connection shutdown still waits for it.
        void this.#dispose().catch((error: unknown) => {
            console.error(`pico: disposing the closed session failed: ${describe(error)}`);
        });
    }

    #requireOpen(): void {
        if (this.#closedReason || this.#disposal) {
            throw RequestError.internalError(
                undefined,
                this.#closedReason ?? "This attachment is closed.",
            );
        }
    }

    /** The engine session is torn down once; every later caller awaits that work. */
    #dispose(): Promise<void> {
        if (!this.#disposal) {
            this.#stopWatchingModel();
            this.#stopWatchingPersistence();
            this.#disposal = (async () => {
                const engineDisposed = await attempt(() => this.#session.dispose());
                const historyClosed = await attempt(() => this.#history?.close());
                const failure = engineDisposed ?? historyClosed;
                if (failure) throw failure.error;
            })();
        }
        return this.#disposal;
    }
}

/** A run that ended in an error, a refusal, or an abort Pico did not ask for. */
function failed(message: AssistantMessage | undefined): boolean {
    return message?.stopReason === "error" || message?.stopReason === "aborted";
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
