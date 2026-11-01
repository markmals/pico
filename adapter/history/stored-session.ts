import type { SessionManager } from "@oh-my-pi/pi-coding-agent";

import { readSessionInfo } from "@oh-my-pi/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

import { describeCause } from "../engine/errors.ts";
import { SessionStoreError } from "./errors.ts";
import { ownedEntry } from "./owned-storage.ts";

/** What a {@link StoredSession} owns, as the store resolved it. */
export interface StoredSessionAttachment {
    readonly manager: SessionManager;
    readonly sessionId: string;
    /** The working directory the journal recorded, canonical. */
    readonly cwd: string;
    /** The journal this attachment writes; saving to any other file is a failure, never a fork. */
    readonly file: string;
    /** Removed with the journal when a never-returned conversation is discarded. */
    readonly artifactsDir: string | null;
    /** Whether `discard()` may remove the journal: true only for a conversation just created. */
    readonly removable: boolean;
    /** Gives up what this attachment holds: its place in the process registry and its storage lease. */
    detach(): void;
}

/** Owns one journal attachment; a persistence failure stays latched until the journal is reopened. */
export class StoredSession {
    readonly manager: SessionManager;
    readonly sessionId: string;
    readonly cwd: string;

    readonly #file: string;
    readonly #artifactsDir: string | null;
    readonly #detach: () => void;
    readonly #observers: (() => void)[] = [];
    readonly #listeners = new Set<(error: Error) => void>();
    #failure: Error | undefined;
    #removable: boolean;
    #closing: Promise<void> | undefined;
    #released = false;

    constructor(attachment: StoredSessionAttachment) {
        this.manager = attachment.manager;
        this.sessionId = attachment.sessionId;
        this.cwd = attachment.cwd;
        this.#file = attachment.file;
        this.#artifactsDir = attachment.artifactsDir;
        this.#removable = attachment.removable;
        this.#detach = attachment.detach;
        // Both subscriptions replay what the manager raised before them, so a
        // failure it latched while the session was being opened is not lost.
        this.#observers.push(
            this.manager.onPersistenceError(error => {
                this.#fail(error);
            }),
            this.manager.onPersistenceNotice(notice => {
                this.#fail(
                    new Error(
                        `its journal moved from ${notice.from} to ${notice.to} (${notice.reason})`,
                    ),
                );
            }),
        );
    }

    /** The failure that ended this attachment's durability, once one has happened. */
    get failure(): Error | undefined {
        return this.#failure;
    }

    /** Checks journal identity before flushing pending writes; rejects any latched save failure. */
    async flush(): Promise<void> {
        if (!this.#failure) await this.#verifyJournal();
        if (!this.#failure) {
            try {
                await this.manager.flush();
            } catch (error) {
                this.#fail(error);
            }
            this.#verifyIdentity();
        }
        if (this.#failure) throw this.#failure;
    }

    /**
     * Calls `listener` with the latched failure, now or when one happens. A
     * released attachment holds no listener: its runtime is gone, and the
     * latched failure is all a late subscriber can learn from it.
     */
    onFailure(listener: (error: Error) => void): () => void {
        if (this.#failure) listener(this.#failure);
        if (this.#released) return () => {};
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Terminal and idempotent: every caller awaits the same writer close, including its failure. */
    close(): Promise<void> {
        if (!this.#closing) {
            this.manager.seal();
            this.#closing = this.manager
                .close()
                .catch((error: unknown) => {
                    this.#fail(error);
                    throw this.#failure;
                })
                .finally(() => {
                    this.manager.releaseRetainedEntries();
                    this.release();
                });
        }
        return this.#closing;
    }

    /** Gives up listeners, observers and ownership for an engine that already closed the manager. */
    release(): void {
        if (this.#released) return;
        this.#released = true;
        for (const stop of this.#observers.splice(0)) stop();
        this.#listeners.clear();
        this.#detach();
    }

    /**
     * Closes this attachment and removes the journal of a conversation that was
     * created here and never returned to a client. A conversation that was
     * opened from storage keeps its history whatever went wrong.
     */
    async discard(): Promise<void> {
        // Whatever failed the start reports itself; this only has to leave
        // nothing behind that would read as a saved conversation.
        await this.close().catch(() => undefined);
        if (!this.#removable) return;
        this.#removable = false;
        if (!(await ownedEntry(path.dirname(this.#file), path.basename(this.#file)))) return;
        const saved = await readSessionInfo(this.#file);
        // Only this conversation's own journal: a file that now holds another
        // session, or none at all, belongs to whoever wrote it.
        if (saved?.id !== this.sessionId) return;
        try {
            await fs.promises.rm(this.#file, { force: true });
            if (this.#artifactsDir) {
                await fs.promises.rm(this.#artifactsDir, { recursive: true, force: true });
            }
        } catch (error) {
            throw new SessionStoreError(
                "storage",
                `could not remove the journal of session ${this.sessionId} at ${this.#file}: ${describeCause(error)}`,
                { sessionId: this.sessionId, cause: error },
            );
        }
    }

    async #verifyJournal(): Promise<void> {
        try {
            const file = await ownedEntry(path.dirname(this.#file), path.basename(this.#file));
            if (!file) throw new Error(`its journal ${this.#file} is gone`);
            await fs.promises.access(path.dirname(file), fs.constants.W_OK | fs.constants.X_OK);
            await fs.promises.access(file, fs.constants.W_OK);
            const saved = await readSessionInfo(file);
            if (saved?.id !== this.sessionId) {
                throw new Error(
                    saved
                        ? `its journal ${file} now holds session ${saved.id}`
                        : `${file} is no longer a session journal`,
                );
            }
        } catch (error) {
            this.#fail(error);
        }
    }

    /** A manager that saves elsewhere, or under another identity, is a failure rather than a fork. */
    #verifyIdentity(): void {
        const file = this.manager.getSessionFile();
        const id = this.manager.getSessionId();
        if (file === this.#file && id === this.sessionId) return;
        this.#fail(new Error(`it now saves to ${file ?? "no journal"} as session ${id}`));
    }

    #fail(cause: unknown): void {
        if (this.#failure) return;
        const failure = new SessionStoreError(
            "storage",
            `could not save session ${this.sessionId}: ${describeCause(cause)}`,
            { sessionId: this.sessionId, cause },
        );
        this.#failure = failure;
        for (const listener of this.#listeners) listener(failure);
    }
}
