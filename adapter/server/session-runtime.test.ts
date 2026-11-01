import type { AgentContext, SessionNotification } from "@agentclientprotocol/sdk";

import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { textDelta } from "../events/engine-event-fixtures.ts";
import { SessionStore } from "../history/session-store.ts";
import { StoredSession } from "../history/stored-session.ts";
import { requestError } from "./agent-harness.ts";
import { fakeSession } from "./fake-session.ts";
import { settle } from "./session-fixture.ts";
import { SessionRuntime } from "./session-runtime.ts";

interface HeldClient {
    readonly client: AgentContext;
    readonly sent: SessionNotification[];
    readonly firstSend: Promise<void>;
    release(): void;
}

/** A client that accepts a notification but holds its delivery until released. */
function heldClient(): HeldClient {
    const sent: SessionNotification[] = [];
    const delivery = Promise.withResolvers<void>();
    const firstSend = Promise.withResolvers<void>();
    // Only `notify` is reachable from a session runtime.
    const client = {
        notify: async (_method: string, params: SessionNotification) => {
            sent.push(params);
            firstSend.resolve();
            await delivery.promise;
        },
    } as unknown as AgentContext;
    return { client, sent, firstSend: firstSend.promise, release: () => delivery.resolve() };
}

/** A client that takes every notification without holding it. */
function quietClient(): AgentContext {
    return { notify: async () => {} } as unknown as AgentContext;
}

describe("proposal.0001 turn admission", () => {
    test("a second prompt is refused until the first turn's updates have been delivered", async () => {
        const held = heldClient();
        const fake = fakeSession("/workspace", {
            prompt: async emit => {
                emit(textDelta("hello"));
                return true;
            },
        });
        const runtime = new SessionRuntime("session-1", fake.session, held.client);

        const first = runtime.prompt("say hello");
        await held.firstSend;
        await settle(20);

        const refusal = await requestError(runtime.prompt("again"));
        expect(refusal.message).toContain("already running");
        expect(fake.calls.filter(call => call === "prompt")).toHaveLength(1);

        held.release();
        expect(await first).toBe("end_turn");
    });

    test("a cancel that lands while an update is in flight keeps the turn reserved", async () => {
        const held = heldClient();
        const fake = fakeSession("/workspace", {
            prompt: async emit => {
                emit(textDelta("hello"));
                return true;
            },
        });
        const runtime = new SessionRuntime("session-1", fake.session, held.client);

        const first = runtime.prompt("say hello");
        await held.firstSend;
        // The engine has answered and the turn is parked on its last update. A cancel
        // arriving now starts an abort the finished turn must still wait for.
        await settle(20);
        runtime.cancel();
        held.release();
        await settle(20);

        const refusal = await requestError(runtime.prompt("again"));
        expect(refusal.message).toContain("already running");
        expect(fake.calls.filter(call => call === "prompt")).toHaveLength(1);

        expect(await first).toBe("cancelled");
    }, 15_000);

    test("a turn is not released until the writes it started have settled", async () => {
        const landed = Promise.withResolvers<void>();
        const fake = fakeSession("/workspace", {
            prompt: async () => true,
            writesSettled: () => landed.promise,
        });
        const runtime = new SessionRuntime("session-1", fake.session, quietClient());

        const first = runtime.prompt("write a file");
        await settle(20);

        // The engine has answered, but a write it started is still in flight: a
        // second turn now would have its own write overwritten by the first's.
        const refusal = await requestError(runtime.prompt("again"));
        expect(refusal.message).toContain("already running");

        landed.resolve();
        expect(await first).toBe("end_turn");
    }, 15_000);
});

describe("proposal.0004 persistence admission", () => {
    test("cancelling while the pre-turn save is pending does not start model work afterwards", async () => {
        const manager = SessionManager.inMemory("/workspace");
        const history = new StoredSession({
            manager,
            sessionId: manager.getSessionId(),
            cwd: "/workspace",
            file: "/unused-history.jsonl",
            artifactsDir: null,
            removable: false,
            detach: () => {},
        });
        const saving = Promise.withResolvers<void>();
        const saved = Promise.withResolvers<void>();
        let flushes = 0;
        history.flush = () => {
            if (flushes++ > 0) return Promise.resolve();
            saving.resolve();
            return saved.promise;
        };
        const fake = fakeSession("/workspace", { prompt: async () => true, abort: async () => {} });
        const runtime = new SessionRuntime(
            manager.getSessionId(),
            fake.session,
            quietClient(),
            history,
        );
        try {
            const turn = runtime.prompt("this turn is cancelled before execution");
            await saving.promise;
            runtime.cancel();
            saved.resolve();
            expect(await turn).toBe("cancelled");
            expect(fake.calls.filter(call => call === "prompt")).toEqual([]);
        } finally {
            saved.resolve();
            await runtime.dispose();
        }
    });

    test("a failed engine teardown still closes its history writer and releases ownership", async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-failed-dispose-")));
        const cwd = join(root, "project");
        const dataDir = join(root, "data");
        mkdirSync(cwd);
        mkdirSync(dataDir);
        const store = new SessionStore(dataDir);
        const history = await store.create(cwd);
        const fake = fakeSession(cwd, {
            dispose: async () => {
                throw new Error("engine teardown failed");
            },
        });
        const runtime = new SessionRuntime(history.sessionId, fake.session, quietClient(), history);
        try {
            await expect(runtime.dispose()).rejects.toThrow("engine teardown failed");
            const reopened = await store.open(history.sessionId, cwd).then(
                value => ({ value }),
                (error: unknown) => ({ error }),
            );
            expect("error" in reopened).toBe(false);
            if ("value" in reopened) await reopened.value.close();
        } finally {
            await history.close().catch(() => {});
            rmSync(root, { recursive: true, force: true });
        }
    });
});
