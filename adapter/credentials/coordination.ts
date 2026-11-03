import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { ensureDataDir } from "../data-dir.ts";
import { CredentialError } from "./errors.ts";

/** The index database doubles as the lock: one write transaction, one mutating process. */
const INDEX_FILENAME = "credentials.db";

/**
 * How long a process waits for another one's credential transaction. Every holder
 * keeps the lock for index work alone — never for a Keychain dialog, a provider
 * request, or anything else that can stall indefinitely — so a wait this long
 * means the holder is wedged rather than busy.
 */
const LOCK_WAIT_MS = 15_000;

export function credentialIndexPath(dataDir: string): string {
    return join(dataDir, INDEX_FILENAME);
}

/** The connection whose transaction this process currently holds, per data directory. */
const holders = new Map<string, Database>();

/**
 * Runs `action` with the credential index locked against every other process.
 *
 * The lock is reentrant: a nested call joins the transaction its caller opened
 * rather than deadlocking against itself, so a settings save can run inside a
 * credential mutation and a credential mutation can save settings. The outermost
 * call owns the transaction and commits or rolls the whole nest back.
 *
 * It needs no credential tables and creates none: an empty database is a valid
 * lock, which is what a settings-only save leaves behind.
 */
export function withCredentialLock<T>(dataDir: string, action: () => T): T {
    const key = credentialIndexPath(resolve(dataDir));
    if (holders.has(key)) return action();

    const database = openForWriting(dataDir, key);
    holders.set(key, database);
    try {
        begin(database, key);
        let value: T;
        try {
            value = action();
        } catch (error) {
            database.run("ROLLBACK");
            throw error;
        }
        database.run("COMMIT");
        return value;
    } finally {
        holders.delete(key);
        database.close();
    }
}

/** The locked connection, for index work running inside {@link withCredentialLock}. */
export function lockedConnection(dataDir: string): Database {
    const database = holders.get(credentialIndexPath(resolve(dataDir)));
    if (!database) {
        throw new CredentialError("INTERNAL", "The credential index was used outside its lock.", {
            details: { dataDir },
        });
    }
    return database;
}

/**
 * Opens the index for reading, or `undefined` when no process has created it.
 * Reading credential metadata must never bring the database into existence, so a
 * missing file is an empty index rather than a new one. The caller closes it.
 */
export function openIndexReader(dataDir: string): Database | undefined {
    const path = credentialIndexPath(dataDir);
    if (!existsSync(path)) return undefined;
    try {
        return new Database(path, { readonly: true });
    } catch (error) {
        throw new CredentialError("IO_ERROR", `Cannot read the credential index at ${path}.`, {
            details: { path },
            cause: error,
        });
    }
}

function openForWriting(dataDir: string, path: string): Database {
    ensureDataDir(dataDir);
    let database: Database;
    try {
        database = new Database(path, { create: true, readwrite: true });
    } catch (error) {
        throw new CredentialError("IO_ERROR", `Cannot open the credential index at ${path}.`, {
            details: { path },
            cause: error,
        });
    }
    try {
        // `new Database`'s mode is filtered by the umask; the index must end up 0600.
        chmodSync(path, 0o600);
        database.run(`PRAGMA busy_timeout = ${LOCK_WAIT_MS}`);
        // Deliberately not WAL: a read-only connection cannot create the shared-memory
        // file a WAL database needs once the last writer has closed, and reading
        // credential metadata must work without opening the index for writing.
    } catch (error) {
        database.close();
        throw new CredentialError("IO_ERROR", `Cannot prepare the credential index at ${path}.`, {
            details: { path },
            cause: error,
        });
    }
    return database;
}

function begin(database: Database, path: string): void {
    try {
        database.run("BEGIN IMMEDIATE");
    } catch (error) {
        throw new CredentialError(
            "UNAVAILABLE",
            "Another Pico process is still changing credentials; try again.",
            { details: { path }, cause: error },
        );
    }
}
