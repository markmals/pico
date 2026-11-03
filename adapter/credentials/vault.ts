import type { AuthCredential, AuthStorage } from "@oh-my-pi/pi-ai";
import type { Database } from "bun:sqlite";

import { randomUUID } from "node:crypto";

import type { CredentialSelector } from "./auth-storage.ts";
import type { IndexRow } from "./index-rows.ts";
import type { SecretStore } from "./keychain.ts";
import type { CredentialMetadata } from "./types.ts";

import { readProviderBindings } from "../settings/settings-store.ts";
import { lockedConnection, openIndexReader, withCredentialLock } from "./coordination.ts";
import { CredentialError, credentialErrorFromKeychain } from "./errors.ts";
import { CredentialIndex, identityOf, metadataOf } from "./index-rows.ts";
import { createKeychain } from "./keychain.ts";
import {
    assertStorableCredential,
    decodeCredentialPayload,
    encodeCredentialPayload,
} from "./payload.ts";

export type { CredentialMetadata } from "./types.ts";
export { CredentialError } from "./errors.ts";

/**
 * How long a creation is reserved before recovery may take over. A late writer
 * compensates its Keychain write instead of publishing over that cleanup.
 */
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export interface OpenVaultOptions {
    dataDir: string;
    allowKeychainUI?: boolean;
    /**
     * The secret store to use. Explicit injection is how a test and the macOS
     * integration task bind a non-production Keychain service; production passes
     * nothing and the vault builds its own. It is never an environment fallback.
     */
    keychain?: SecretStore;
}

export interface StoredCredential {
    metadata: CredentialMetadata;
    /** The SDK's row id for this credential. Private to the engine, never printed. */
    rowId: number;
    credential: AuthCredential;
}

export interface CredentialVault {
    /** The opaque index revision, or `"none"` when no credential was ever stored. */
    revision(): string;
    list(provider?: string): CredentialMetadata[];
    metadata(reference: string): CredentialMetadata | undefined;
    /** Validates the Keychain payload without exposing it. */
    verify(reference: string): CredentialMetadata;
    read(reference: string): StoredCredential;
    create(
        provider: string,
        credential: AuthCredential,
        options?: { ifRevision?: string; signal?: AbortSignal },
    ): CredentialMetadata;
    delete(reference: string, options?: { ifRevision?: string }): boolean;
    locked<T>(action: () => T): T;
    authStorage(references?: CredentialSelector): Promise<AuthStorage>;
    close(): void;
}

/**
 * Opens Pico's credential vault over `dataDir`. Opening reads nothing and creates
 * nothing: a data directory without credentials stays untouched until a mutation
 * needs the index.
 */
export function openCredentialVault(options: OpenVaultOptions): CredentialVault {
    return new KeychainVault(options);
}

class KeychainVault implements CredentialVault {
    readonly #dataDir: string;
    readonly #allowKeychainUI: boolean;
    #keychain: SecretStore | undefined;
    #reader: Database | undefined;

    constructor(options: OpenVaultOptions) {
        this.#dataDir = options.dataDir;
        this.#allowKeychainUI = options.allowKeychainUI ?? false;
        this.#keychain = options.keychain;
    }

    revision(): string {
        return this.#index()?.revision() ?? "none";
    }

    list(provider?: string): CredentialMetadata[] {
        const index = this.#index();
        if (!index) return [];
        return index.list(provider === undefined ? undefined : { provider }).map(metadataOf);
    }

    metadata(reference: string): CredentialMetadata | undefined {
        const row = this.#index()?.findByReference(reference);
        return row ? metadataOf(row) : undefined;
    }

    verify(reference: string): CredentialMetadata {
        return this.read(reference).metadata;
    }

    read(reference: string): StoredCredential {
        const row = this.#requireActive(reference);
        const text = this.#readItem(row);
        if (text === null) {
            throw new CredentialError(
                "UNAVAILABLE",
                `The Keychain item for credential ${reference} is gone. ` +
                    "Store the credential again, or select another one.",
                { details: { reference, provider: row.provider } },
            );
        }
        const { credential } = decodeCredentialPayload({ reference, provider: row.provider }, text);
        return { metadata: metadataOf(row), rowId: row.id, credential };
    }

    create(
        provider: string,
        credential: AuthCredential,
        options?: { ifRevision?: string; signal?: AbortSignal },
    ): CredentialMetadata {
        const stored = storableCredential(credential);
        assertStorableCredential(stored);
        throwIfAborted(options?.signal);
        this.#recoverAbandonedCreations();

        const reference = randomUUID();
        withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            index.ensureSchema();
            this.#requireRevision(index, options?.ifRevision);
            index.insertPending({
                reference,
                provider,
                kind: stored.type,
                attemptExpiresAtMs: Date.now() + ATTEMPT_WINDOW_MS,
            });
        });

        // The item must exist before the row becomes visible, and the write can
        // raise an OS permission dialog, so it runs outside the lock.
        try {
            throwIfAborted(options?.signal);
            this.#keychainStore().set(
                reference,
                encodeCredentialPayload({
                    reference,
                    provider,
                    kind: stored.type,
                    credential: stored,
                }),
            );
            throwIfAborted(options?.signal);

            return withCredentialLock(this.#dataDir, () => {
                const index = new CredentialIndex(lockedConnection(this.#dataDir));
                index.publish(reference, identityOf(stored));
                index.bumpRevision();
                const row = index.findByReference(reference);
                if (!row || row.state !== "active") {
                    throw new CredentialError(
                        "CONFLICT",
                        `Credential ${reference}'s reservation expired while it was being stored; retry the operation.`,
                        { details: { reference, provider } },
                    );
                }
                return metadataOf(row);
            });
        } catch (error) {
            this.#cleanupCreation(reference, provider, stored.type);
            throw error instanceof CredentialError
                ? error
                : credentialErrorFromKeychain(error, { operation: "store", reference, provider });
        }
    }

    delete(reference: string, options?: { ifRevision?: string }): boolean {
        this.#recoverAbandonedCreations();

        const row = withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            if (!index.hasSchema()) return undefined;
            this.#requireRevision(index, options?.ifRevision);
            const found = index.findByReference(reference);
            if (!found) return undefined;
            if (found.state === "active") {
                this.#requireUnreferenced(found);
                index.markDeleting(reference);
                index.bumpRevision();
            }
            return found;
        });
        if (!row) return false;

        try {
            this.#keychainStore().delete(reference);
        } catch (error) {
            throw credentialErrorFromKeychain(error, {
                operation: "delete",
                reference,
                provider: row.provider,
            });
        }

        withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            index.remove(reference);
            index.bumpRevision();
        });
        return true;
    }

    locked<T>(action: () => T): T {
        return withCredentialLock(this.#dataDir, action);
    }

    async authStorage(references?: CredentialSelector): Promise<AuthStorage> {
        // Loaded here so the dry-run and discovery paths never pull in the SDK.
        const { openAuthStorage } = await import("./auth-storage.ts");
        return openAuthStorage({
            dataDir: this.#dataDir,
            keychain: this.#keychainStore(),
            references,
        });
    }

    close(): void {
        this.#reader?.close();
        this.#reader = undefined;
    }

    #index(): CredentialIndex | undefined {
        this.#reader ??= openIndexReader(this.#dataDir);
        if (!this.#reader) return undefined;
        const index = new CredentialIndex(this.#reader);
        return index.hasSchema() ? index : undefined;
    }

    #keychainStore(): SecretStore {
        this.#keychain ??= createKeychain({
            dataDir: this.#dataDir,
            allowKeychainUI: this.#allowKeychainUI,
        });
        return this.#keychain;
    }

    #requireActive(reference: string): IndexRow {
        const row = this.#index()?.findByReference(reference);
        if (!row || row.state !== "active") {
            throw new CredentialError("NOT_FOUND", `No active Pico credential ${reference}.`, {
                details: { reference },
            });
        }
        return row;
    }

    #readItem(row: IndexRow): string | null {
        try {
            return this.#keychainStore().get(row.reference);
        } catch (error) {
            throw credentialErrorFromKeychain(error, {
                operation: "read",
                reference: row.reference,
                provider: row.provider,
            });
        }
    }

    #requireRevision(index: CredentialIndex, ifRevision: string | undefined): void {
        if (ifRevision === undefined) return;
        const current = index.revision();
        if (current === ifRevision) return;
        throw new CredentialError(
            "CONFLICT",
            "The stored credentials changed since you read them; read them again and retry.",
            { details: { expected: ifRevision, revision: current } },
        );
    }

    /** A credential a provider binding still names is deleted only after it is unbound. */
    #requireUnreferenced(row: IndexRow): void {
        let bindings: Record<string, string>;
        try {
            bindings = readProviderBindings(this.#dataDir);
        } catch (error) {
            throw new CredentialError(
                "FAILED_PRECONDITION",
                `Pico cannot tell whether credential ${row.reference} is still selected: ` +
                    "its settings file is unusable.",
                { details: { reference: row.reference }, cause: error },
            );
        }
        for (const [provider, reference] of Object.entries(bindings)) {
            if (reference !== row.reference) continue;
            throw new CredentialError(
                "FAILED_PRECONDITION",
                `Credential ${row.reference} is still selected for ${provider}. ` +
                    `Run \`pico providers update ${provider} --disconnect\` first.`,
                { details: { reference: row.reference, provider } },
            );
        }
    }

    #cleanupCreation(reference: string, provider: string, kind: AuthCredential["type"]): void {
        const staged = withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            const changed = index.stageCreationCleanup({ reference, provider, kind });
            if (changed) index.bumpRevision();
            return changed;
        });
        if (!staged) return;
        try {
            this.#keychainStore().delete(reference);
        } catch (error) {
            throw credentialErrorFromKeychain(error, { operation: "delete", reference, provider });
        }
        withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            index.remove(reference);
            index.bumpRevision();
        });
    }

    #abandon(reference: string): void {
        withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            index.remove(reference);
            index.bumpRevision();
        });
    }

    /** Claims recovery ownership before native cleanup can race a late publication. */
    #recoverAbandonedCreations(): void {
        const abandoned = withCredentialLock(this.#dataDir, () => {
            const index = new CredentialIndex(lockedConnection(this.#dataDir));
            return index.hasSchema() ? index.abandonedCreations(Date.now()) : [];
        });
        for (const reference of abandoned) {
            const claimed = withCredentialLock(this.#dataDir, () => {
                const index = new CredentialIndex(lockedConnection(this.#dataDir));
                const changed = index.claimExpiredCreation(reference, Date.now());
                if (changed) index.bumpRevision();
                return changed;
            });
            if (!claimed) continue;
            try {
                this.#keychainStore().delete(reference);
            } catch {
                // Keep the deleting reference visible for an explicit cleanup retry.
                continue;
            }
            this.#abandon(reference);
        }
    }
}

/**
 * Every API key Pico stores was handed to it explicitly, which is what the SDK's
 * `login` source marks. The SDK's credential cascade puts that leg ahead of a
 * provider environment variable, so the marker is what keeps an ambient key from
 * outranking the credential a user selected.
 */
function storableCredential(credential: AuthCredential): AuthCredential {
    if (credential.type !== "api_key") return credential;
    return { type: "api_key", key: credential.key, source: "login" };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    throw new CredentialError("CANCELLED", "The credential operation was cancelled.", {
        details: {},
    });
}
