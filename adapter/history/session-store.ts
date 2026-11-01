import type { SessionHeader } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { SessionLoadResult } from "@oh-my-pi/pi-coding-agent/session/session-loader";

import { findSessionFiles, FileSessionStorage, SessionManager } from "@oh-my-pi/pi-coding-agent";
import {
    createInterruptedToolResults,
    createInterruptedTurnAbortMessage,
} from "@oh-my-pi/pi-coding-agent/session/exit-diagnostics";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { loadSessionFile } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { sessionDirForCwd } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import fs from "node:fs";
import path from "node:path";

import type { StoredSessionPage } from "./listing.ts";

import { describeCause } from "../engine/errors.ts";
import { SessionStoreError } from "./errors.ts";
import { listStoredSessions } from "./listing.ts";
import { ownedEntry, ownedRoot, scanOwnedJournals } from "./owned-storage.ts";
import { canonicalDirectory, requireProject } from "./storage-paths.ts";
import { StoredSession } from "./stored-session.ts";

export { SessionStoreError } from "./errors.ts";
export type { SessionStoreErrorKind } from "./errors.ts";
export type { StoredSessionPage, StoredSessionSummary } from "./listing.ts";
export { StoredSession } from "./stored-session.ts";

// Reject path-shaped identifiers before any journal lookup.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// SDK leases are process-reentrant; this reservation prevents a second local attachment.
const attached = new Map<string, StoredSession | null>();

/** Scoped OMP-format journals and exclusive live attachments; no terminal-history discovery. */
export class SessionStore {
    readonly #root: string;
    readonly #storage = new FileSessionStorage();

    constructor(dataDir: string) {
        this.#root = path.join(dataDir, "sessions");
    }

    /**
     * Starts a conversation in `cwd` and returns it already saved, so the
     * identifier a client receives can be reopened before its first prompt.
     */
    async create(cwd: string): Promise<StoredSession> {
        const project = requireProject(cwd);
        const root = await this.#writableRoot();
        const sessionDir = await this.#writableBucket(root, sessionDirForCwd(project, root));

        let manager: SessionManager;
        try {
            // A materialized journal with its own identity, in Pico's bucket and
            // without the terminal breadcrumb that would register it as the
            // terminal's current OMP session.
            manager = await SessionManager.inMemory(project).persistCopy(
                { sessionDir, suppressBreadcrumb: true },
                this.#storage,
            );
        } catch (error) {
            throw new SessionStoreError(
                "storage",
                `could not start a conversation in ${sessionDir}: ${describeCause(error)}`,
                { cause: error },
            );
        }

        const sessionId = manager.getSessionId();
        const file = manager.getSessionFile();
        if (!file) {
            await manager.close().catch(() => undefined);
            throw new SessionStoreError(
                "storage",
                `the new conversation in ${sessionDir} was not written to disk`,
                { sessionId },
            );
        }

        const stored = await this.#attach(manager, sessionId, project, file, true);
        try {
            await stored.flush();
        } catch (error) {
            await stored.discard().catch(() => undefined);
            throw error;
        }
        return stored;
    }

    /**
     * Attaches to the stored conversation `sessionId` in `cwd`, after proving it
     * is that conversation, that nothing else is writing it, and that its last
     * process left no turn open.
     */
    async open(sessionId: string, cwd: string): Promise<StoredSession> {
        if (!SESSION_ID.test(sessionId)) {
            throw new SessionStoreError(
                "invalid",
                `"${sessionId}" is not a Pico session identifier`,
                { sessionId },
            );
        }
        const project = requireProject(cwd);
        const file = await this.#locate(sessionId);
        const header = await this.#readHeader(sessionId, file);
        if (canonicalDirectory(header.cwd) !== project) {
            throw new SessionStoreError(
                "invalid",
                `session ${sessionId} belongs to ${header.cwd}, and the request named "${cwd}"`,
                { sessionId },
            );
        }

        // Ownership first: a repair extends the journal, so it must not race the
        // process that may still be writing it.
        const detach = this.#claim(sessionId, file);
        let manager: SessionManager;
        try {
            manager = await SessionManager.open(file, path.dirname(file), this.#storage, {
                initialCwd: project,
                suppressBreadcrumb: true,
                throwIfMissing: true,
            });
        } catch (error) {
            detach();
            throw new SessionStoreError(
                "storage",
                `could not open the journal of session ${sessionId} at ${file}: ${describeCause(error)}`,
                { sessionId, cause: error },
            );
        }
        if (manager.getSessionId() !== sessionId || manager.getSessionFile() !== file) {
            await manager.close().catch(() => undefined);
            detach();
            throw new SessionStoreError(
                "invalid",
                `the journal at ${file} opened as session ${manager.getSessionId()}, not as ${sessionId}`,
                { sessionId },
            );
        }

        const stored = new StoredSession({
            manager,
            sessionId,
            cwd: project,
            file,
            artifactsDir: manager.getArtifactsDir(),
            removable: false,
            detach,
        });
        attached.set(sessionId, stored);
        try {
            await closeInterruptedTail(manager, sessionId);
            await stored.flush();
        } catch (error) {
            // A conversation that could not be attached keeps its history.
            await stored.close().catch(() => undefined);
            throw error;
        }
        return stored;
    }

    /**
     * One page of the conversations Pico stores, newest first.
     *
     * Listing derives what the journals already hold and nothing more: no
     * engine, MCP server or credential is involved, no attachment of this
     * process is touched, and a project that has been removed still lists its
     * own conversations. Saving what a live attachment is holding belongs to
     * that attachment's own connection, which flushes before it answers.
     */
    async list(
        query: { cwd?: string | null; cursor?: string | null } = {},
    ): Promise<StoredSessionPage> {
        const filter =
            query.cwd === undefined || query.cwd === null ? null : canonicalDirectory(query.cwd);
        return await listStoredSessions(this.#root, this.#storage, filter, query.cursor ?? null);
    }

    /**
     * The one journal in Pico's storage that carries `sessionId`.
     *
     * The scan comes first and is authoritative: it refuses anything below the
     * root that leads out of it, so a client's identifier can never reach an
     * archive Pico does not own, and nothing outside is read to find out.
     */
    async #locate(sessionId: string): Promise<string> {
        const owned = await scanOwnedJournals(this.#root);
        const found = new Set(owned.files);
        const files = owned.root
            ? (await findSessionFiles(sessionId, owned.root)).filter(file => found.has(file))
            : [];
        if (files.length === 0) {
            throw new SessionStoreError("not-found", `Pico has no stored session ${sessionId}`, {
                sessionId,
            });
        }
        if (files.length > 1) {
            throw new SessionStoreError(
                "invalid",
                `session ${sessionId} is stored more than once, in ${files.join(" and ")}`,
                { sessionId },
            );
        }
        return files[0]!;
    }

    /**
     * Pico's session root, created when it is missing. A root that is not the
     * `sessions` directory of Pico's own data directory is refused before
     * anything is written through it.
     */
    async #writableRoot(): Promise<string> {
        const existing = await ownedRoot(this.#root);
        if (existing) return existing;
        try {
            fs.mkdirSync(this.#root, { recursive: true, mode: 0o700 });
        } catch (error) {
            throw new SessionStoreError(
                "storage",
                `could not create ${this.#root}: ${describeCause(error)}`,
                { cause: error },
            );
        }
        const created = await ownedRoot(this.#root);
        if (created) return created;
        throw new SessionStoreError("storage", `could not create ${this.#root}`);
    }

    /** The bucket a working directory's conversations belong in, created when it is missing. */
    async #writableBucket(root: string, bucket: string): Promise<string> {
        const name = path.basename(bucket);
        const existing = await ownedEntry(root, name);
        if (existing) return existing;
        try {
            fs.mkdirSync(path.join(root, name), { mode: 0o700 });
        } catch (error) {
            throw new SessionStoreError(
                "storage",
                `could not create ${bucket}: ${describeCause(error)}`,
                { cause: error },
            );
        }
        const created = await ownedEntry(root, name);
        if (created) return created;
        throw new SessionStoreError("storage", `could not create ${bucket}`);
    }

    /**
     * The header of a journal Pico is willing to open: its own format, its whole
     * record intact, and the identity that was asked for.
     */
    async #readHeader(sessionId: string, file: string): Promise<SessionHeader> {
        let loaded: SessionLoadResult;
        try {
            loaded = await loadSessionFile(file, this.#storage, { throwIfMissing: true });
        } catch (error) {
            throw new SessionStoreError(
                "storage",
                `could not read the journal of session ${sessionId} at ${file}: ${describeCause(error)}`,
                { sessionId, cause: error },
            );
        }
        const header = loaded.entries.find(entry => entry.type === "session") as
            | SessionHeader
            | undefined;
        if (loaded.invalidHeader || !header) {
            throw new SessionStoreError(
                "invalid",
                `the journal of session ${sessionId} at ${file} has no session header`,
                { sessionId },
            );
        }
        if (loaded.malformedRecords > 0) {
            throw new SessionStoreError(
                "invalid",
                `the journal of session ${sessionId} at ${file} holds ${loaded.malformedRecords} damaged record(s)`,
                { sessionId },
            );
        }
        if ((header.version ?? 1) > CURRENT_SESSION_VERSION) {
            throw new SessionStoreError(
                "invalid",
                `the journal of session ${sessionId} at ${file} is format version ${header.version}, and this agent reads up to ${CURRENT_SESSION_VERSION}`,
                { sessionId },
            );
        }
        if (header.id !== sessionId) {
            throw new SessionStoreError(
                "invalid",
                `the journal at ${file} holds session ${header.id}, not ${sessionId}`,
                { sessionId },
            );
        }
        return header;
    }

    /** Takes exclusive ownership of `sessionId`, in this process and against every other. */
    #claim(sessionId: string, file: string): () => void {
        if (attached.has(sessionId)) {
            throw new SessionStoreError(
                "busy",
                `session ${sessionId} is already open in this agent`,
                { sessionId },
            );
        }
        const release = this.#storage.claimSession(sessionId, file);
        if (!release) {
            throw new SessionStoreError(
                "busy",
                `session ${sessionId} is already open in another process`,
                { sessionId },
            );
        }
        attached.set(sessionId, null);
        let detached = false;
        return () => {
            if (detached) return;
            detached = true;
            attached.delete(sessionId);
            release();
        };
    }

    async #attach(
        manager: SessionManager,
        sessionId: string,
        cwd: string,
        file: string,
        removable: boolean,
    ): Promise<StoredSession> {
        let detach: () => void;
        try {
            // The registry check and its reservation run before this function
            // ever yields, so two openings cannot both pass it.
            detach = this.#claim(sessionId, file);
        } catch (error) {
            await manager.close().catch(() => undefined);
            throw error;
        }
        const stored = new StoredSession({
            manager,
            sessionId,
            cwd,
            file,
            artifactsDir: manager.getArtifactsDir(),
            removable,
            detach,
        });
        attached.set(sessionId, stored);
        return stored;
    }
}

/**
 * Closes the turn a process left open when it stopped, once ownership has
 * proved that process is gone.
 *
 * The public helpers decide what is unfinished, including the crash that
 * recorded no exit at all, and they see the records they already wrote: a
 * conversation reopened twice is repaired once. Nothing is executed again — an
 * operation that may have changed files before it stopped is reported as an
 * unknown outcome, not retried and not rolled back.
 */
async function closeInterruptedTail(manager: SessionManager, sessionId: string): Promise<void> {
    const branch = manager.getBranch();
    const abort = createInterruptedTurnAbortMessage(branch, undefined, { assumeExit: true });
    if (!abort) return;
    try {
        await manager.appendEntriesAtomically(() => {
            for (const result of createInterruptedToolResults(branch))
                manager.appendMessage(result);
            manager.appendMessage(abort);
        });
    } catch (error) {
        throw new SessionStoreError(
            "storage",
            `could not close the interrupted turn of session ${sessionId}: ${describeCause(error)}`,
            { sessionId, cause: error },
        );
    }
}
