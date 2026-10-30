import type { AgentContext, SessionUpdate } from "@agentclientprotocol/sdk";

/**
 * One session's `session/update` notifications, written in the order the engine
 * produced them. A turn's response waits on {@link drained}, so no update can
 * overtake an earlier one or the response that ends the turn.
 */
export class UpdateQueue {
    readonly #client: AgentContext;
    readonly #sessionId: string;
    #tail: Promise<void> = Promise.resolve();

    constructor(client: AgentContext, sessionId: string) {
        this.#client = client;
        this.#sessionId = sessionId;
    }

    push(update: SessionUpdate): void {
        this.#tail = this.#tail.then(() =>
            // A closed connection is not this session's failure to report.
            this.#client
                .notify("session/update", { sessionId: this.#sessionId, update })
                .catch(() => {}),
        );
    }

    drained(): Promise<void> {
        return this.#tail;
    }
}
