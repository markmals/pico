import type { Database } from "bun:sqlite";

/**
 * The index holds identity, lifecycle and refresh coordination — never a
 * credential payload, a serialized comparison operand or a token fingerprint.
 * `pending` rows are creations whose Keychain write has not been published yet:
 * nonselectable, and recoverable because they keep the reference the item uses.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('api_key', 'oauth')),
    state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'deleting')),
    email TEXT,
    account_id TEXT,
    org_id TEXT,
    org_name TEXT,
    attempt_expires_at_ms INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_by_provider ON credentials (provider);
CREATE TABLE IF NOT EXISTS credential_revision (
    id INTEGER PRIMARY KEY CHECK (id = 0),
    revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_refresh_leases (
    credential_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
`;

export const INDEX_VERSION = 1;

export function ensureIndexSchema(database: Database): void {
    database.run(SCHEMA);
    database.run(`PRAGMA user_version = ${INDEX_VERSION}`);
}

/** Whether a database file some other mutation created already holds credential tables. */
export function hasIndexSchema(database: Database): boolean {
    const found = database
        .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credentials'",
        )
        .get();
    return found !== null && found !== undefined;
}
