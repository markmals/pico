import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";

import type { DisposalPhase, PicoSession } from "../engine/pico-session.ts";

/**
 * A session whose engine does exactly what a test says.
 *
 * It exists for the turns a real engine cannot be scripted into: an `abort()`
 * that never settles or rejects, and a `prompt()` that outlives its own
 * cancellation.
 */
export interface FakeEngine {
    /** Runs the turn. Defaults to a promise that never settles. */
    prompt?: (emit: (event: AgentSessionEvent) => void) => Promise<boolean>;
    /** Stops the turn. Defaults to a promise that never settles. */
    abort?: () => Promise<void>;
    /** Tears the session down. Defaults to resolving at once. */
    dispose?: () => Promise<void>;
    /** Resolves once the writes the turn started have landed. Defaults to resolving at once. */
    writesSettled?: () => Promise<void>;
    /** The teardown step the session reports while `dispose()` is pending. */
    disposalPhase?: DisposalPhase;
}

export interface FakeSession {
    readonly session: PicoSession;
    /** `prompt`, `abort` and `dispose` in the order Pico called them. */
    readonly calls: string[];
    readonly disposals: number;
}

export function neverSettles<T>(): Promise<T> {
    return Promise.withResolvers<T>().promise;
}

export function fakeSession(cwd: string, behaviour: FakeEngine = {}): FakeSession {
    const calls: string[] = [];
    const counters = { disposals: 0 };
    const listeners = new Set<(event: AgentSessionEvent) => void>();
    let disposalPhase: DisposalPhase | undefined;

    // Only the surface the ACP server drives; the rest of AgentSession is unreachable from here.
    const model = { provider: "fake", id: "model", name: "Fake model", reasoning: false };
    const engine = {
        model,
        getAvailableModels: () => [model],
        getAvailableThinkingLevels: () => [],
        configuredThinkingLevel: () => undefined,
        subscribe: (subscriber: (event: AgentSessionEvent) => void) => {
            listeners.add(subscriber);
            return () => {
                listeners.delete(subscriber);
            };
        },
        prompt: () => {
            calls.push("prompt");
            const emit = (event: AgentSessionEvent) => {
                for (const listener of listeners) listener(event);
            };
            return behaviour.prompt?.(emit) ?? neverSettles<boolean>();
        },
        abort: () => {
            calls.push("abort");
            return behaviour.abort?.() ?? neverSettles<void>();
        },
    } as unknown as AgentSession;

    return {
        session: {
            engine,
            cwd,
            get disposalPhase() {
                return disposalPhase;
            },
            takeChanges: () => [],
            writesSettled: () => behaviour.writesSettled?.() ?? Promise.resolve(),
            mcpToolIdentity: () => undefined,
            selectModel: () => Promise.reject(new Error("the fake session cannot switch models")),
            selectThinkingLevel: () => {
                throw new Error("the fake session cannot set a thinking level");
            },
            dispose: async () => {
                calls.push("dispose");
                counters.disposals++;
                disposalPhase = behaviour.disposalPhase;
                await (behaviour.dispose?.() ?? Promise.resolve());
                disposalPhase = undefined;
            },
        },
        calls,
        get disposals() {
            return counters.disposals;
        },
    };
}
