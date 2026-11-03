import type {
    AuthCredential,
    AuthCredentialStore,
    CredentialRefreshLeaseFence,
    CredentialRefreshLeaseHolder,
    StoredAuthCredential,
} from "@oh-my-pi/pi-ai";
import type { Database } from "bun:sqlite";

import { AuthStorage } from "@oh-my-pi/pi-ai";
import { createHash, randomBytes } from "node:crypto";

import type { IndexRow } from "./index-rows.ts";
import type { SecretStore } from "./keychain.ts";

import { lockedConnection, openIndexReader, withCredentialLock } from "./coordination.ts";
import { ExpiringCache } from "./credential-cache.ts";
import { CredentialError, credentialErrorFromKeychain } from "./errors.ts";
import { RefreshLeases } from "./index-leases.ts";
import { CredentialIndex, identityOf } from "./index-rows.ts";
import { decodeCredentialPayload, encodeCredentialPayload } from "./payload.ts";

/**
 * Which credentials a store exposes. A function is re-read on every store access,
 * so a provider binding changed in another process reaches the next request
 * without rebuilding the session's registry.
 */
export type CredentialSelector = readonly string[] | (() => readonly string[]);

export interface KeychainStoreOptions {
    dataDir: string;
    keychain: SecretStore;
    references?: CredentialSelector;
}

/**
 * The compare-and-set token the SDK computes for a credential. The vault keeps
 * these bytes in memory only: a late writer proves it holds the credential it
 * means to replace by comparing against the live Keychain payload, never against
 * a copy persisted in SQL.
 */
export function serializedCredentialData(credential: AuthCredential): string | null {
    if (credential.type === "api_key") {
        return JSON.stringify(
            credential.source === "login"
                ? { key: credential.key, source: "login" }
                : { key: credential.key },
        );
    }
    if (credential.type === "oauth") {
        const { type: _type, ...rest } = credential;
        return JSON.stringify(rest);
    }
    return null;
}

export function createKeychainCredentialStore(options: KeychainStoreOptions): AuthCredentialStore {
    return new KeychainCredentialStore(options);
}

/** The SDK facade over Pico's vault, with its credential snapshot explicitly loaded. */
export async function openAuthStorage(options: KeychainStoreOptions): Promise<AuthStorage> {
    const storage = new AuthStorage(createKeychainCredentialStore(options), {
        sourceLabel: "Pico Keychain",
    });
    try {
        // Construction leaves the credential cache empty; only a reload fills it.
        await storage.credentials.reload();
    } catch (error) {
        storage.close();
        throw error;
    }
    return storage;
}

/**
 * `AuthCredentialStore` whose rows live in Pico's index and whose secrets live in
 * the Keychain. It supports exactly what Pico's vault can honour: reading the
 * selected rows, persisting a refreshed grant under a durable lease, and a real
 * expiring cache. Everything that would destroy or replace a user's credential
 * behind their back refuses instead of reporting a success it did not perform.
 */
class KeychainCredentialStore implements AuthCredentialStore {
    readonly #dataDir: string;
    readonly #keychain: SecretStore;
    readonly #selector: (() => readonly string[]) | undefined;
    readonly #cache = new ExpiringCache();
    readonly #salt = randomBytes(32);
    #reader: Database | undefined;
    #observedChange: string | undefined;
    #closed = false;

    constructor(options: KeychainStoreOptions) {
        this.#dataDir = options.dataDir;
        // Refresh commits hold the metadata lock, so their Keychain view must forbid dialogs.
        this.#keychain = options.keychain.withoutInteraction();
        const references = options.references;
        if (typeof references === "function") {
            this.#selector = references;
            return;
        }
        if (references) {
            const fixed = [...references];
            this.#requireActive(fixed);
            this.#selector = () => fixed;
        }
    }

    close(): void {
        this.#closed = true;
        this.#reader?.close();
        this.#reader = undefined;
        this.#cache.clear();
    }

    listAuthCredentials(provider?: string): StoredAuthCredential[] {
        return this.#selectedRows(provider).map(row => ({
            id: row.id,
            provider: row.provider,
            credential: this.#requirePayload(row),
            disabledCause: null,
        }));
    }

    /**
     * True once per observed change, so the SDK reloads instead of serving a credential
     * it cached earlier. Three things count: the binding this store follows, an index
     * mutation another process committed, and the Keychain payload behind a reference
     * that did not itself change. The third is why the token covers the payloads — a
     * peer's refresh, and a removed item, leave both the reference and the index
     * revision exactly as they were.
     */
    pollExternalChanges(): boolean {
        const observed = this.#changeKey();
        const changed = this.#observedChange !== undefined && this.#observedChange !== observed;
        this.#observedChange = observed;
        return changed;
    }

    acknowledgeLocalChanges(): void {
        this.#observedChange = this.#changeKey();
    }

    /**
     * Saves a refreshed grant. An unconditional save whose row is gone cannot be
     * reported as done: the token the provider just minted would exist nowhere, and
     * the caller would carry on using an access token nothing persisted.
     */
    updateAuthCredential(id: number, credential: AuthCredential): void {
        this.#assertOpen();
        withCredentialLock(this.#dataDir, () => {
            const row = this.#index()?.findById(id);
            if (!row || row.state !== "active") {
                throw new CredentialError(
                    "NOT_FOUND",
                    `Pico has no active credential to save under row ${id}; ` +
                        "it was deleted while the grant was being refreshed.",
                    { details: { rowId: id } },
                );
            }
            this.#write(row, credential);
        });
    }

    /**
     * Publishes an exchanged grant only while this process still owns the refresh and
     * the stored bytes are still the ones it set out to replace.
     *
     * The row lookup, the lease fence, the re-read of the stored payload and the
     * Keychain write are one step under the index lock. Checking and then writing
     * without it is not a fence at all: a peer whose clock has passed the lease's
     * expiry can take the lease over in the gap, rotate the grant, and still lose it
     * to this process's write. The write is safe to hold the lock across because the
     * SDK only ever sees the noninteractive Keychain view, so nothing here can stop
     * to ask the human a question.
     */
    tryUpdateAuthCredentialIfMatches(
        id: number,
        expectedData: string,
        credential: AuthCredential,
        lease?: CredentialRefreshLeaseFence,
    ): boolean {
        this.#assertOpen();
        return withCredentialLock(this.#dataDir, () => {
            const database = lockedConnection(this.#dataDir);
            const index = new CredentialIndex(database);
            if (!index.hasSchema()) return false;
            // Selection governs request use, not preservation of an already-rotated grant.
            const row = index.findById(id);
            if (!row || row.state !== "active") return false;
            if (lease && !new RefreshLeases(database).holds(id, lease.owner, lease.nowMs)) {
                return false;
            }
            const stored = this.#payload(row);
            if (!stored || serializedCredentialData(stored) !== expectedData) return false;
            const incoming = serializedCredentialData(credential);
            if (incoming === null) return false;
            // The row already holds exactly these bytes; rewriting the item would only
            // churn the Keychain and re-prompt for access.
            if (incoming === expectedData) return true;
            this.#write(row, credential);
            return true;
        });
    }

    // Pico credentials are created and removed by explicit commands. The SDK's
    // destructive paths — duplicate pruning on reload, provider-wide login
    // replacement, logout, and disabling a grant it judges dead — would silently
    // take a stored credential away, so they refuse with the command that does it.

    deleteAuthCredential(id: number, disabledCause: string): Promise<boolean> {
        const row = this.#selectedRows().find(candidate => candidate.id === id);
        return Promise.reject(this.#refusal(row?.reference, disabledCause));
    }

    tryDisableAuthCredentialIfMatches(
        id: number,
        _expectedData: string,
        disabledCause: string,
    ): boolean {
        const row = this.#selectedRows().find(candidate => candidate.id === id);
        throw this.#refusal(row?.reference, disabledCause);
    }

    replaceAuthCredentials(provider: string): Promise<StoredAuthCredential[]> {
        return Promise.reject(this.#providerRefusal(provider));
    }

    upsertAuthCredential(provider: string): Promise<StoredAuthCredential[]> {
        return Promise.reject(this.#providerRefusal(provider));
    }

    deleteAuthCredentials(provider: string): Promise<void> {
        return Promise.reject(this.#providerRefusal(provider));
    }

    getCache(key: string, options?: { includeExpired?: boolean }): string | null {
        this.#assertOpen();
        return this.#cache.get(key, options);
    }

    setCache(key: string, value: string, expiresAtSec: number): void {
        this.#assertOpen();
        this.#cache.set(key, value, expiresAtSec);
    }

    deleteCachePrefix(prefix: string): void {
        this.#assertOpen();
        this.#cache.deletePrefix(prefix);
    }

    cleanExpiredCache(): void {
        this.#assertOpen();
        this.#cache.cleanExpired();
    }

    tryAcquireCredentialRefreshLease(
        credentialId: number,
        owner: string,
        expiresAtMs: number,
    ): boolean {
        return this.#mutateLeases(leases =>
            leases.acquire(credentialId, owner, expiresAtMs, Date.now()),
        );
    }

    getCredentialRefreshLeaseExpiresAt(credentialId: number): number | undefined {
        return this.#withLeases(leases => leases.expiresAt(credentialId));
    }

    getCredentialRefreshLeaseHolder(
        credentialId: number,
    ): CredentialRefreshLeaseHolder | undefined {
        return this.#withLeases(leases => leases.holder(credentialId));
    }

    renewCredentialRefreshLease(credentialId: number, owner: string, expiresAtMs: number): boolean {
        return this.#mutateLeases(leases => leases.renew(credentialId, owner, expiresAtMs));
    }

    releaseCredentialRefreshLease(credentialId: number, owner: string): void {
        this.#mutateLeases(leases => {
            leases.release(credentialId, owner);
            return true;
        });
    }

    handBackCredentialRefreshLease(
        credentialId: number,
        owner: string,
        holder: CredentialRefreshLeaseHolder,
    ): boolean {
        return this.#mutateLeases(leases => leases.handBack(credentialId, owner, holder));
    }

    #assertOpen(): void {
        if (this.#closed) {
            throw new CredentialError("FAILED_PRECONDITION", "Pico's credential store is closed.");
        }
    }

    #index(): CredentialIndex | undefined {
        this.#assertOpen();
        this.#reader ??= openIndexReader(this.#dataDir);
        if (!this.#reader) return undefined;
        const index = new CredentialIndex(this.#reader);
        return index.hasSchema() ? index : undefined;
    }

    /**
     * The active rows this store exposes. A selected reference with no active row
     * is omitted rather than replaced: the credential a binding names is gone, and
     * the caller that owns the binding reports that, never another account.
     */
    #selectedRows(provider?: string): IndexRow[] {
        const index = this.#index();
        if (!index) return [];
        const rows = index.list({ provider }).filter(row => row.state === "active");
        if (!this.#selector) return rows;
        const selected = new Set(this.#selector());
        return rows.filter(row => selected.has(row.reference));
    }

    #requireActive(references: readonly string[]): void {
        const rows = this.#index()?.list() ?? [];
        const active = new Set<string>(
            rows.filter(row => row.state === "active").map(row => row.reference),
        );
        for (const reference of references) {
            if (active.has(reference)) continue;
            throw new CredentialError("NOT_FOUND", `No active Pico credential ${reference}.`, {
                details: { reference },
            });
        }
    }

    #payload(row: IndexRow): AuthCredential | undefined {
        let text: string | null;
        try {
            text = this.#keychain.get(row.reference);
        } catch (error) {
            throw credentialErrorFromKeychain(error, {
                operation: "read",
                reference: row.reference,
                provider: row.provider,
            });
        }
        if (text === null) return undefined;
        return decodeCredentialPayload({ reference: row.reference, provider: row.provider }, text)
            .credential;
    }

    #requirePayload(row: IndexRow): AuthCredential {
        const credential = this.#payload(row);
        if (credential) return credential;
        throw new CredentialError(
            "UNAVAILABLE",
            `The Keychain item for credential ${row.reference} is gone.`,
            { details: { reference: row.reference, provider: row.provider } },
        );
    }

    #write(row: IndexRow, credential: AuthCredential): void {
        const payload = encodeCredentialPayload({
            reference: row.reference,
            provider: row.provider,
            kind: credential.type,
            credential,
        });
        try {
            this.#keychain.set(row.reference, payload);
        } catch (error) {
            throw credentialErrorFromKeychain(error, {
                operation: "save",
                reference: row.reference,
                provider: row.provider,
            });
        }
        // A refresh keeps the credential's identity, so the index records the account
        // metadata the new grant carries without moving the index revision.
        withCredentialLock(this.#dataDir, () => {
            new CredentialIndex(lockedConnection(this.#dataDir)).updateIdentity(
                row.id,
                identityOf(credential),
            );
        });
    }

    #changeKey(): string {
        const revision = this.#index()?.revision() ?? "none";
        const selected = this.#selector ? [...this.#selector()].sort().join(",") : "*";
        const payloads = this.#selectedRows()
            .map(row => `${row.reference}:${this.#payloadTag(row)}`)
            .sort()
            .join(",");
        return `${revision}|${selected}|${payloads}`;
    }

    /**
     * A tag that moves whenever the stored bytes move, without being those bytes. The
     * salt is this store's own, so the tag means nothing outside this process and
     * matches no precomputed digest; it lives in memory for the store's lifetime and
     * reaches no database, journal, log or error. Reporting a failure is not this
     * method's job — `listAuthCredentials` raises the typed error — but an unreadable
     * item must still move the tag, or the reload that surfaces it never happens.
     */
    #payloadTag(row: IndexRow): string {
        let text: string | null;
        try {
            text = this.#keychain.get(row.reference);
        } catch {
            return "unreadable";
        }
        if (text === null) return "missing";
        return createHash("sha256").update(this.#salt).update(text).digest("hex");
    }

    #withLeases<T>(read: (leases: RefreshLeases) => T): T | undefined {
        if (!this.#index() || !this.#reader) return undefined;
        return read(new RefreshLeases(this.#reader));
    }

    #mutateLeases(write: (leases: RefreshLeases) => boolean): boolean {
        this.#assertOpen();
        return withCredentialLock(this.#dataDir, () => {
            const database = lockedConnection(this.#dataDir);
            if (!new CredentialIndex(database).hasSchema()) return false;
            return write(new RefreshLeases(database));
        });
    }

    #refusal(reference: string | undefined, _cause: string): CredentialError {
        const named = reference ?? "that credential";
        return new CredentialError(
            "FAILED_PRECONDITION",
            `Pico will not remove credential ${named} on its own. ` +
                "Replace it with `pico auth login`, or remove it with `pico credentials delete`.",
            { details: { reference } },
        );
    }

    #providerRefusal(provider: string): CredentialError {
        return new CredentialError(
            "FAILED_PRECONDITION",
            `Pico will not replace every stored credential for ${provider}. ` +
                "Store one with `pico credentials create` or `pico auth login`.",
            { details: { provider } },
        );
    }
}
