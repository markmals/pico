import type { SessionStorage } from "@oh-my-pi/pi-coding-agent";

import { listAllSessions } from "@oh-my-pi/pi-coding-agent";
import path from "node:path";

import { SessionStoreError } from "./errors.ts";
import { scanOwnedJournals } from "./owned-storage.ts";

/** What one stored conversation reports about itself to a client listing them. */
export interface StoredSessionSummary {
    sessionId: string;
    cwd: string;
    title?: string;
    updatedAt?: string;
}

export interface StoredSessionPage {
    sessions: StoredSessionSummary[];
    nextCursor?: string;
}

/** One page of a listing; the rest follows a continuation cursor. */
const PAGE_SIZE = 50;

/** The encoding of the cursors below. A client holding an older one is told to start again. */
const CURSOR_VERSION = 1;

/** A conversation with the ordering key the listing pages by. */
interface OrderedSummary extends StoredSessionSummary {
    readonly updatedMs: number;
}

/** Where a continuation resumes: the last conversation the previous page reported. */
interface CursorKey {
    readonly updatedMs: number;
    readonly sessionId: string;
}

/**
 * The conversations stored under `root`, newest first and then by identifier,
 * one page at a time.
 *
 * Discovery is Pico's own: only journals in its own buckets, with a directory
 * it cannot read, a journal it cannot parse, and anything leading out of its
 * storage reported rather than quietly left out of the page.
 */
export async function listStoredSessions(
    root: string,
    storage: SessionStorage,
    filter: string | null,
    cursor: string | null,
): Promise<StoredSessionPage> {
    const after = cursor === null ? undefined : decodeCursor(cursor, filter);
    const owned = await scanOwnedJournals(root);
    if (!owned.root || owned.files.length === 0) return { sessions: [] };

    const scanned = new Map(
        (await listAllSessions(storage, owned.root)).map(info => [path.resolve(info.path), info]),
    );
    const summaries: OrderedSummary[] = [];
    for (const file of owned.files) {
        const info = scanned.get(file);
        if (!info) {
            throw new SessionStoreError(
                "storage",
                `${file} is in Pico's session storage but does not read as a session journal`,
            );
        }
        if (!path.isAbsolute(info.cwd)) {
            throw new SessionStoreError(
                "storage",
                `${file} records no working directory for session ${info.id}`,
                { sessionId: info.id },
            );
        }
        summaries.push({
            sessionId: info.id,
            cwd: info.cwd,
            title: info.title || undefined,
            updatedAt: info.modified.toISOString(),
            updatedMs: info.modified.getTime(),
        });
    }

    const matching = filter === null ? summaries : summaries.filter(entry => entry.cwd === filter);
    // Code point order for the tie-break: a locale collation that ignores "-"
    // would page identifiers in an order the next request cannot continue.
    matching.sort(
        (left, right) =>
            right.updatedMs - left.updatedMs ||
            (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0),
    );

    const remaining = after ? matching.filter(entry => follows(entry, after)) : matching;
    const page = remaining.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    if (remaining.length <= PAGE_SIZE || !last) return { sessions: page.map(reported) };
    return {
        sessions: page.map(reported),
        nextCursor: encodeCursor({ updatedMs: last.updatedMs, sessionId: last.sessionId }, filter),
    };
}

/** Whether this conversation sorts after the one a cursor ended on. */
function follows(entry: OrderedSummary, after: CursorKey): boolean {
    if (entry.updatedMs !== after.updatedMs) return entry.updatedMs < after.updatedMs;
    return entry.sessionId > after.sessionId;
}

function reported(entry: OrderedSummary): StoredSessionSummary {
    return {
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        title: entry.title,
        updatedAt: entry.updatedAt,
    };
}

function encodeCursor(key: CursorKey, filter: string | null): string {
    const payload = { v: CURSOR_VERSION, at: key.updatedMs, id: key.sessionId, cwd: filter };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * A cursor is bound to its directory filter: using another listing's ordering
 * key could silently skip conversations.
 */
function decodeCursor(cursor: string, filter: string | null): CursorKey {
    if (!/^[A-Za-z0-9_-]{8,4096}$/.test(cursor)) throw unusableCursor();
    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
        throw unusableCursor();
    }
    if (typeof payload !== "object" || payload === null) throw unusableCursor();
    const { v, at, id, cwd } = payload as Record<string, unknown>;
    if (v !== CURSOR_VERSION) {
        throw new SessionStoreError(
            "invalid",
            `the continuation cursor uses listing format ${String(v)}; this agent supports ${CURSOR_VERSION}`,
        );
    }
    if (typeof at !== "number" || !Number.isFinite(at) || typeof id !== "string" || !id) {
        throw unusableCursor();
    }
    if (cwd !== filter) {
        throw new SessionStoreError(
            "invalid",
            "the continuation cursor belongs to a different working-directory filter; list from the first page again",
        );
    }
    return { updatedMs: at, sessionId: id };
}

function unusableCursor(): SessionStoreError {
    return new SessionStoreError(
        "invalid",
        "the continuation cursor is malformed; list from the first page again",
    );
}
