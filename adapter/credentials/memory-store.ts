import type { AuthCredential, AuthCredentialStore, StoredAuthCredential } from "@oh-my-pi/pi-ai";

import { matchesReplacementCredential, resolveCredentialIdentityKey } from "@oh-my-pi/pi-ai";

import { serializedCredentialData } from "./auth-storage.ts";
import { ExpiringCache } from "./credential-cache.ts";

interface StagedRow {
    id: number;
    provider: string;
    credential: AuthCredential;
    disabledCause: string | null;
}

/**
 * A real `AuthCredentialStore` that lives only in memory, for one login attempt.
 *
 * `AuthStorage.oauth.login` stores its result through the store it was given and
 * replaces the provider's other rows while doing so. Running it against this
 * store keeps the SDK's own enrichment and destination-provider mapping while
 * leaving Pico's vault untouched, so a completed login commits deliberately
 * instead of rewriting a provider's stored credentials as a side effect. Nothing
 * is written to disk, and `close()` drops everything.
 */
export function createMemoryCredentialStore(): AuthCredentialStore {
    const rows: StagedRow[] = [];
    const cache = new ExpiringCache();
    let nextId = 1;

    const active = (provider?: string): StagedRow[] =>
        rows.filter(
            row =>
                row.disabledCause === null && (provider === undefined || row.provider === provider),
        );

    const snapshot = (provider?: string): StoredAuthCredential[] =>
        active(provider).map(row => ({
            id: row.id,
            provider: row.provider,
            credential: row.credential,
            disabledCause: null,
        }));

    return {
        close() {
            rows.length = 0;
            cache.clear();
        },

        listAuthCredentials(provider?: string) {
            return snapshot(provider);
        },

        updateAuthCredential(id: number, credential: AuthCredential) {
            const row = rows.find(candidate => candidate.id === id);
            if (row && row.disabledCause === null) row.credential = credential;
        },

        deleteAuthCredential(id: number, disabledCause: string) {
            const row = rows.find(candidate => candidate.id === id);
            if (!row || row.disabledCause !== null) return Promise.resolve(false);
            row.disabledCause = disabledCause;
            return Promise.resolve(true);
        },

        tryDisableAuthCredentialIfMatches(id: number, expectedData: string, disabledCause: string) {
            const row = rows.find(candidate => candidate.id === id);
            if (!row || row.disabledCause !== null) return false;
            if (serializedCredentialData(row.credential) !== expectedData) return false;
            row.disabledCause = disabledCause;
            return true;
        },

        replaceAuthCredentials(provider: string, credentials: AuthCredential[]) {
            for (const row of active(provider)) row.disabledCause = "replaced";
            for (const credential of credentials) {
                rows.push({ id: nextId++, provider, credential, disabledCause: null });
            }
            return Promise.resolve(snapshot(provider));
        },

        upsertAuthCredential(provider: string, credential: AuthCredential) {
            const existing = active(provider).find(row =>
                matchesReplacementCredential(
                    provider,
                    row.credential,
                    resolveCredentialIdentityKey(provider, row.credential),
                    credential,
                ),
            );
            if (existing) existing.credential = credential;
            else rows.push({ id: nextId++, provider, credential, disabledCause: null });
            return Promise.resolve(snapshot(provider));
        },

        deleteAuthCredentials(provider: string, disabledCause: string) {
            for (const row of active(provider)) row.disabledCause = disabledCause;
            return Promise.resolve();
        },

        getCache(key: string, options?: { includeExpired?: boolean }) {
            return cache.get(key, options);
        },

        setCache(key: string, value: string, expiresAtSec: number) {
            cache.set(key, value, expiresAtSec);
        },

        cleanExpiredCache() {
            cache.cleanExpired();
        },
    };
}
