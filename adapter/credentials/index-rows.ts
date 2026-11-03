import type { AuthCredential } from "@oh-my-pi/pi-ai";
import type { Database } from "bun:sqlite";

import { createHash, randomBytes } from "node:crypto";

import type { CredentialKind, CredentialMetadata } from "./types.ts";

import { ensureIndexSchema, hasIndexSchema } from "./index-schema.ts";

/** A credential's lifecycle in the index. `pending` never reaches a caller. */
export type IndexState = "pending" | "active" | "deleting";

/** One index row: identity and lifecycle, never payload. */
export interface IndexRow {
    id: number;
    reference: string;
    provider: string;
    kind: CredentialKind;
    state: IndexState;
    email?: string;
    accountId?: string;
    orgId?: string;
    orgName?: string;
}

/** Provider-supplied account identity, which refresh can update without changing identity. */
export interface AccountIdentity {
    email?: string;
    accountId?: string;
    orgId?: string;
    orgName?: string;
}

/** The account identity a stored grant carries; an API key has none. */
export function identityOf(credential: AuthCredential): AccountIdentity {
    if (credential.type !== "oauth") return {};
    return {
        email: credential.email,
        accountId: credential.accountId,
        orgId: credential.orgId,
        orgName: credential.orgName,
    };
}

interface CredentialRecord {
    id: number;
    reference: string;
    provider: string;
    kind: string;
    state: string;
    email: string | null;
    account_id: string | null;
    org_id: string | null;
    org_name: string | null;
}

/** States a caller can see. A `pending` row is an unfinished creation, not a credential. */
const VISIBLE = "state IN ('active', 'deleting')";

const COLUMNS =
    "id, reference, provider, kind, state, email, account_id, org_id, org_name FROM credentials";

/**
 * The credential index over one SQLite connection: the locked write connection
 * inside {@link withCredentialLock}, or a read-only connection for lookups.
 */
export class CredentialIndex {
    readonly #database: Database;

    constructor(database: Database) {
        this.#database = database;
    }

    ensureSchema(): void {
        ensureIndexSchema(this.#database);
    }

    hasSchema(): boolean {
        return hasIndexSchema(this.#database);
    }

    /** The opaque revision of the visible index, in proposal 0007's revision shape. */
    revision(): string {
        const row = this.#database
            .query<{ revision: string }, []>(
                "SELECT revision FROM credential_revision WHERE id = 0",
            )
            .get();
        return row?.revision ?? "none";
    }

    /** Moves the revision to a fresh opaque value. Callers bump it once per visible change. */
    bumpRevision(): string {
        const revision = `sha256:${createHash("sha256").update(randomBytes(32)).digest("hex")}`;
        this.#database.run(
            `INSERT INTO credential_revision (id, revision) VALUES (0, ?)
             ON CONFLICT(id) DO UPDATE SET revision = excluded.revision`,
            [revision],
        );
        return revision;
    }

    list(filter?: { provider?: string; references?: readonly string[] }): IndexRow[] {
        const where = [VISIBLE];
        const parameters: string[] = [];
        if (filter?.provider !== undefined) {
            where.push("provider = ?");
            parameters.push(filter.provider);
        }
        if (filter?.references) {
            if (filter.references.length === 0) return [];
            where.push(`reference IN (${filter.references.map(() => "?").join(", ")})`);
            parameters.push(...filter.references);
        }
        return this.#database
            .query<CredentialRecord, string[]>(
                `SELECT ${COLUMNS} WHERE ${where.join(" AND ")} ORDER BY id`,
            )
            .all(...parameters)
            .map(toRow);
    }

    findByReference(reference: string): IndexRow | undefined {
        const record = this.#database
            .query<CredentialRecord, [string]>(
                `SELECT ${COLUMNS} WHERE reference = ? AND ${VISIBLE}`,
            )
            .get(reference);
        return record ? toRow(record) : undefined;
    }

    findById(id: number): IndexRow | undefined {
        const record = this.#database
            .query<CredentialRecord, [number]>(`SELECT ${COLUMNS} WHERE id = ? AND ${VISIBLE}`)
            .get(id);
        return record ? toRow(record) : undefined;
    }

    /** Reserves a credential's identity before its Keychain item exists. */
    insertPending(reservation: {
        reference: string;
        provider: string;
        kind: CredentialKind;
        attemptExpiresAtMs: number;
    }): number {
        const now = Date.now();
        this.#database.run(
            `INSERT INTO credentials
                (reference, provider, kind, state, attempt_expires_at_ms, created_at_ms, updated_at_ms)
             VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
            [
                reservation.reference,
                reservation.provider,
                reservation.kind,
                reservation.attemptExpiresAtMs,
                now,
                now,
            ],
        );
        const row = this.#database
            .query<{ id: number }, [string]>("SELECT id FROM credentials WHERE reference = ?")
            .get(reservation.reference);
        if (!row) throw new Error("the reserved credential row disappeared");
        return row.id;
    }

    /** Publishes a reserved row, which is the moment the credential becomes real. */
    publish(reference: string, identity: AccountIdentity): void {
        this.#database.run(
            `UPDATE credentials
             SET state = 'active', email = ?, account_id = ?, org_id = ?, org_name = ?,
                 attempt_expires_at_ms = 0, updated_at_ms = ?
             WHERE reference = ? AND state = 'pending'`,
            [...identityValues(identity), Date.now(), reference],
        );
    }

    /** Refreshed grants carry new account metadata under the same identity. */
    updateIdentity(id: number, identity: AccountIdentity): void {
        this.#database.run(
            `UPDATE credentials
             SET email = ?, account_id = ?, org_id = ?, org_name = ?, updated_at_ms = ?
             WHERE id = ?`,
            [...identityValues(identity), Date.now(), id],
        );
    }

    markDeleting(reference: string): void {
        this.#database.run(
            "UPDATE credentials SET state = 'deleting', updated_at_ms = ? WHERE reference = ?",
            [Date.now(), reference],
        );
    }

    /** Retains an unpublished item's identity until its compensating deletion succeeds. */
    stageCreationCleanup(creation: {
        reference: string;
        provider: string;
        kind: CredentialKind;
    }): boolean {
        const now = Date.now();
        return (
            this.#database.run(
                `INSERT INTO credentials
                (reference, provider, kind, state, attempt_expires_at_ms, created_at_ms, updated_at_ms)
             VALUES (?, ?, ?, 'deleting', 0, ?, ?)
             ON CONFLICT(reference) DO UPDATE SET
                state = 'deleting', attempt_expires_at_ms = 0, updated_at_ms = excluded.updated_at_ms
             WHERE credentials.state != 'active'`,
                [creation.reference, creation.provider, creation.kind, now, now],
            ).changes > 0
        );
    }

    remove(reference: string): void {
        const row = this.#database
            .query<{ id: number }, [string]>("SELECT id FROM credentials WHERE reference = ?")
            .get(reference);
        if (!row) return;
        this.#database.run("DELETE FROM credential_refresh_leases WHERE credential_id = ?", [
            row.id,
        ]);
        this.#database.run("DELETE FROM credentials WHERE reference = ?", [reference]);
    }

    claimExpiredCreation(reference: string, nowMs: number): boolean {
        return (
            this.#database.run(
                `UPDATE credentials
             SET state = 'deleting', attempt_expires_at_ms = 0, updated_at_ms = ?
             WHERE reference = ? AND state = 'pending' AND attempt_expires_at_ms <= ?`,
                [nowMs, reference, nowMs],
            ).changes > 0
        );
    }

    /** Expired pending references, oldest first; cleanup still needs an atomic claim. */
    abandonedCreations(nowMs: number): string[] {
        return this.#database
            .query<{ reference: string }, [number]>(
                `SELECT reference FROM credentials
                 WHERE state = 'pending' AND attempt_expires_at_ms <= ? ORDER BY id`,
            )
            .all(nowMs)
            .map(row => row.reference);
    }
}

/** The non-secret projection a command prints. */
export function metadataOf(row: IndexRow): CredentialMetadata {
    const metadata: CredentialMetadata = {
        reference: row.reference,
        provider: row.provider,
        kind: row.kind,
        state: row.state === "deleting" ? "deleting" : "active",
    };
    if (row.email !== undefined) metadata.email = row.email;
    if (row.accountId !== undefined) metadata.accountId = row.accountId;
    if (row.orgId !== undefined) metadata.orgId = row.orgId;
    if (row.orgName !== undefined) metadata.orgName = row.orgName;
    return metadata;
}

function identityValues(identity: AccountIdentity): (string | null)[] {
    return [
        identity.email ?? null,
        identity.accountId ?? null,
        identity.orgId ?? null,
        identity.orgName ?? null,
    ];
}

function toRow(record: CredentialRecord): IndexRow {
    const row: IndexRow = {
        id: record.id,
        reference: record.reference,
        provider: record.provider,
        kind: record.kind === "oauth" ? "oauth" : "api_key",
        state: indexState(record.state),
    };
    if (record.email !== null) row.email = record.email;
    if (record.account_id !== null) row.accountId = record.account_id;
    if (record.org_id !== null) row.orgId = record.org_id;
    if (record.org_name !== null) row.orgName = record.org_name;
    return row;
}

function indexState(state: string): IndexState {
    if (state === "pending") return "pending";
    return state === "deleting" ? "deleting" : "active";
}
