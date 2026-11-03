import type { CredentialRefreshLeaseHolder } from "@oh-my-pi/pi-ai";
import type { Database } from "bun:sqlite";

interface LeaseRecord {
    owner: string;
    expires_at_ms: number;
}

/**
 * Durable per-credential refresh ownership, in the SDK's lease vocabulary: one
 * owner at a time, takeover only once the lease lapses, renewal and release only
 * by the owner, and hand-back to the holder a takeover displaced. A lease outlives
 * the process that took it, so a crashed refresher does not strand the credential
 * and a restarted one does not silently resume ownership it no longer has.
 */
export class RefreshLeases {
    readonly #database: Database;

    constructor(database: Database) {
        this.#database = database;
    }

    /** Takes the lease when nobody holds a live one. Not a renewal: the holder renews. */
    acquire(credentialId: number, owner: string, expiresAtMs: number, nowMs: number): boolean {
        const result = this.#database.run(
            `INSERT INTO credential_refresh_leases (credential_id, owner, expires_at_ms, updated_at_ms)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(credential_id) DO UPDATE SET
                 owner = excluded.owner,
                 expires_at_ms = excluded.expires_at_ms,
                 updated_at_ms = excluded.updated_at_ms
             WHERE credential_refresh_leases.expires_at_ms <= ?`,
            [credentialId, owner, expiresAtMs, nowMs, nowMs],
        );
        return result.changes > 0;
    }

    /** The stored expiry, whether or not it has passed; `undefined` when no lease row exists. */
    expiresAt(credentialId: number): number | undefined {
        return this.#holder(credentialId)?.expires_at_ms;
    }

    /** The lease row as stored, so a taker can recognise the owner it displaced. */
    holder(credentialId: number): CredentialRefreshLeaseHolder | undefined {
        const record = this.#holder(credentialId);
        return record ? { owner: record.owner, expiresAtMs: record.expires_at_ms } : undefined;
    }

    renew(credentialId: number, owner: string, expiresAtMs: number): boolean {
        const result = this.#database.run(
            `UPDATE credential_refresh_leases SET expires_at_ms = ?, updated_at_ms = ?
             WHERE credential_id = ? AND owner = ?`,
            [expiresAtMs, Date.now(), credentialId, owner],
        );
        return result.changes > 0;
    }

    release(credentialId: number, owner: string): void {
        this.#database.run(
            "DELETE FROM credential_refresh_leases WHERE credential_id = ? AND owner = ?",
            [credentialId, owner],
        );
    }

    /** Returns a taken-over lease to the holder it displaced, with that holder's own expiry. */
    handBack(credentialId: number, owner: string, holder: CredentialRefreshLeaseHolder): boolean {
        const result = this.#database.run(
            `UPDATE credential_refresh_leases SET owner = ?, expires_at_ms = ?, updated_at_ms = ?
             WHERE credential_id = ? AND owner = ?`,
            [holder.owner, holder.expiresAtMs, Date.now(), credentialId, owner],
        );
        return result.changes > 0;
    }

    /** The fence a late writer must pass: this owner still holds a lease that has not lapsed. */
    holds(credentialId: number, owner: string, nowMs: number): boolean {
        const record = this.#holder(credentialId);
        return record !== undefined && record.owner === owner && record.expires_at_ms > nowMs;
    }

    #holder(credentialId: number): LeaseRecord | undefined {
        const record = this.#database
            .query<LeaseRecord, [number]>(
                "SELECT owner, expires_at_ms FROM credential_refresh_leases WHERE credential_id = ?",
            )
            .get(credentialId);
        return record ?? undefined;
    }
}
