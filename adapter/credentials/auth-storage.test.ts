import type { AuthCredential, OAuthCredential } from "@oh-my-pi/pi-ai";

import { AuthStorage, hasRefreshLeases } from "@oh-my-pi/pi-ai";
import { serializeCredential } from "@oh-my-pi/pi-ai/auth/sqlite-credential-store";
import { registerOAuthProvider, unregisterOAuthProvider } from "@oh-my-pi/pi-ai/registry";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemorySecretStore } from "./testing/memory-secret-store.ts";

import { createKeychainCredentialStore, serializedCredentialData } from "./auth-storage.ts";
import { CredentialError } from "./errors.ts";
import { encodeCredentialPayload } from "./payload.ts";
import { createMemorySecretStore } from "./testing/memory-secret-store.ts";
import { openCredentialVault } from "./vault.ts";

const API_KEY = "pico-fake-api-key-c3RvcmU";
const OTHER_KEY = "pico-fake-api-key-b3RoZXI";

const apiKeyCredential = (key = API_KEY): AuthCredential => ({ type: "api_key", key });

const oauthCredential = (access = "pico-fake-access-1"): OAuthCredential => ({
    type: "oauth",
    access,
    refresh: "pico-fake-refresh-1",
    expires: Date.now() + 3_600_000,
    email: "person@example.com",
    accountId: "account-1",
});

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-auth-storage-")));
    roots.push(root);
    return join(root, "Pico");
}

function indexBytes(dataDir: string): string {
    return readdirSync(dataDir)
        .map(entry => readFileSync(join(dataDir, entry)).toString("binary"))
        .join("");
}

function rewritePayload(
    keychain: MemorySecretStore,
    reference: string,
    provider: string,
    credential: AuthCredential,
): void {
    keychain.items.set(
        reference,
        encodeCredentialPayload({
            reference,
            provider,
            kind: credential.type,
            credential,
        }),
    );
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 the Keychain-backed SDK credential store", () => {
    test("it implements the SDK's durable refresh-lease concern", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const store = createKeychainCredentialStore({ dataDir, keychain });

        expect(hasRefreshLeases(store)).toBe(true);
        store.close();
    });

    test("it offers no inert version of the capabilities it does not support", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const store = createKeychainCredentialStore({ dataDir, keychain });

        expect(store.getCredentialBlock).toBeUndefined();
        expect(store.upsertCredentialBlock).toBeUndefined();
        expect(store.recordUsageSnapshots).toBeUndefined();
        expect(store.refreshOAuthCredential).toBeUndefined();
        expect(store.refreshSnapshot).toBeUndefined();
        expect(store.listDisabledCredentials).toBeUndefined();
        store.close();
    });

    test("its compare-and-set token is the one the SDK computes", () => {
        for (const credential of [apiKeyCredential(), oauthCredential()]) {
            const sdk = serializeCredential("anthropic", credential);
            // The SDK returns null only for a credential kind it cannot store; these
            // two are the kinds Pico stores, so a null here would be the real finding.
            expect(sdk).not.toBeNull();
            expect(serializedCredentialData(credential)).toBe(sdk === null ? null : sdk.data);
        }
    });

    test("a storage facade holds nothing until the vault reloads it", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("openai", apiKeyCredential());

        const unloaded = new AuthStorage(createKeychainCredentialStore({ dataDir, keychain }));
        expect(unloaded.credentials.list()).toEqual([]);

        const loaded = await vault.authStorage();
        expect(loaded.credentials.list().map(row => row.provider)).toEqual(["openai"]);
        expect(loaded.credentials.list()[0]?.id).toBe(vault.read(stored.reference).rowId);
        vault.close();
    });

    test("a reference restriction exposes exactly those rows", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const selected = vault.create("openai", apiKeyCredential());
        vault.create("openai", apiKeyCredential(OTHER_KEY));
        vault.create("anthropic", oauthCredential());

        const storage = await vault.authStorage([selected.reference]);

        expect(storage.credentials.list()).toHaveLength(1);
        expect(storage.credentials.get("openai")).toEqual({
            type: "api_key",
            key: API_KEY,
            source: "login",
        });
        expect(storage.credentials.has("anthropic")).toBe(false);
        vault.close();
    });

    test("a restricted reference that is not active fails instead of finding a sibling", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const sibling = vault.create("openai", apiKeyCredential(OTHER_KEY));
        const removed = vault.create("openai", apiKeyCredential());
        vault.delete(removed.reference);

        const failure = await vault.authStorage([removed.reference]).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(CredentialError);
        expect((failure as CredentialError).code).toBe("NOT_FOUND");
        expect((failure as CredentialError).details).toMatchObject({
            reference: removed.reference,
        });
        expect(JSON.stringify((failure as CredentialError).details)).not.toContain(
            sibling.reference,
        );
        vault.close();
    });

    test("listing rows returns the payload the Keychain holds now", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const store = createKeychainCredentialStore({ dataDir, keychain });

        rewritePayload(keychain, stored.reference, "anthropic", oauthCredential("rotated-access"));

        const rows = store.listAuthCredentials("anthropic");
        expect(rows[0]?.credential).toMatchObject({ type: "oauth", access: "rotated-access" });
        store.close();
        vault.close();
    });

    test("an update writes through to the Keychain before it returns", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });

        store.updateAuthCredential(rowId, oauthCredential("refreshed-access"));

        expect(keychain.writes).toContain(stored.reference);
        const reopened = openCredentialVault({ dataDir, keychain });
        expect((reopened.read(stored.reference).credential as OAuthCredential).access).toBe(
            "refreshed-access",
        );
        reopened.close();
        store.close();
        vault.close();
    });

    test("an update refreshes the row's non-secret account metadata", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });

        store.updateAuthCredential(rowId, {
            ...oauthCredential(),
            email: "moved@example.com",
            orgName: "Org Two",
        });

        expect(vault.metadata(stored.reference)).toMatchObject({
            email: "moved@example.com",
            orgName: "Org Two",
        });
        store.close();
        vault.close();
    });

    test("a compare-and-set refuses to overwrite a grant another process rotated", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        // The same object the vault stored: the expected bytes must describe the grant
        // this caller actually read, not an equivalent one minted a millisecond later.
        const original = oauthCredential();
        const stored = vault.create("anthropic", original);
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });
        const expected = serializedCredentialData(original);

        rewritePayload(keychain, stored.reference, "anthropic", oauthCredential("peer-rotated"));
        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            expected ?? "",
            oauthCredential("stale-winner"),
        );

        expect(saved).toBe(false);
        expect((vault.read(stored.reference).credential as OAuthCredential).access).toBe(
            "peer-rotated",
        );
        store.close();
        vault.close();
    });

    test("a compare-and-set that matches replaces the Keychain payload", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const original = oauthCredential();
        const stored = vault.create("anthropic", original);
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(original) ?? "",
            oauthCredential("fresh-access"),
        );

        expect(saved).toBe(true);
        expect((vault.read(stored.reference).credential as OAuthCredential).access).toBe(
            "fresh-access",
        );
        store.close();
        vault.close();
    });

    for (const disconnect of [false, true]) {
        test(`an in-flight refresh persists its rotated grant after ${disconnect ? "disconnect" : "selection changes"}`, async () => {
            const provider = "pico-refresh-selection-test";
            const started = Promise.withResolvers<void>();
            const finish = Promise.withResolvers<OAuthCredential>();
            const original = { ...oauthCredential(), expires: 1 };
            const rotated = {
                ...original,
                access: "FAKE-rotated-access",
                refresh: "FAKE-rotated-refresh",
                expires: Date.now() + 3_600_000,
            };
            registerOAuthProvider({
                id: provider,
                name: "Synthetic refresh-selection provider",
                login: async () => original,
                refreshToken: async () => {
                    started.resolve();
                    return finish.promise;
                },
                getApiKey: credential => credential.access,
            });
            const dataDir = temporaryDataDir();
            const keychain = createMemorySecretStore();
            const vault = openCredentialVault({ dataDir, keychain });
            const first = vault.create(provider, original);
            const second = vault.create(provider, {
                ...oauthCredential("FAKE-second-access"),
                accountId: "second-account",
            });
            let selected = [first.reference];
            const storage = await vault.authStorage(() => selected);
            const request = storage.keys.get(provider);
            try {
                await Promise.race([
                    started.promise,
                    request.then(() => {
                        throw new Error("The request ended without starting its refresh");
                    }),
                ]);
                selected = disconnect ? [] : [second.reference];
                finish.resolve(rotated);
                await request;

                expect(vault.read(first.reference).credential).toMatchObject({
                    access: rotated.access,
                    refresh: rotated.refresh,
                });
                expect(await storage.keys.get(provider)).toBe(
                    disconnect ? undefined : "FAKE-second-access",
                );
            } finally {
                finish.resolve(rotated);
                storage.close();
                vault.close();
                unregisterOAuthProvider(provider);
            }
        });
    }

    test("the index keeps no serialized credential bytes for its compare-and-set", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const original = oauthCredential();
        const stored = vault.create("anthropic", original);
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(original) ?? "",
            oauthCredential("fresh-access"),
        );

        expect(saved).toBe(true);
        store.close();
        vault.close();

        const bytes = indexBytes(dataDir);
        expect(bytes).not.toContain("pico-fake-access-1");
        expect(bytes).not.toContain("fresh-access");
        expect(bytes).not.toContain("pico-fake-refresh-1");
    });

    test("the SDK cannot destroy a Pico credential through the store", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });

        await expect(
            store.deleteAuthCredential(rowId, "deduplicated duplicate credential"),
        ).rejects.toBeInstanceOf(CredentialError);
        await expect(
            store.deleteAuthCredentials("anthropic", "deleted by user"),
        ).rejects.toBeInstanceOf(CredentialError);
        await expect(
            store.replaceAuthCredentials("anthropic", [apiKeyCredential()]),
        ).rejects.toBeInstanceOf(CredentialError);
        await expect(
            store.upsertAuthCredential("anthropic", apiKeyCredential()),
        ).rejects.toBeInstanceOf(CredentialError);
        expect(() =>
            store.tryDisableAuthCredentialIfMatches(
                rowId,
                serializedCredentialData(oauthCredential()) ?? "",
                "oauth refresh failed",
            ),
        ).toThrow(CredentialError);

        expect(vault.metadata(stored.reference)?.state).toBe("active");
        expect(keychain.items.has(stored.reference)).toBe(true);
        store.close();
        vault.close();
    });

    test("SDK refusal diagnostics cannot expose provider-supplied secret material", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const original = oauthCredential();
        const stored = vault.create("anthropic", original);
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });
        try {
            for (let seed = 0; seed < 32; seed++) {
                const marker = `FAKE-private-provider-response-${seed}`;
                for (const refuse of [
                    () => store.deleteAuthCredential(rowId, marker),
                    () =>
                        store.tryDisableAuthCredentialIfMatches(
                            rowId,
                            serializedCredentialData(original) ?? "",
                            marker,
                        ),
                ]) {
                    const failure = await Promise.resolve()
                        .then(refuse)
                        .catch(error => error);
                    expect(failure).toBeInstanceOf(CredentialError);
                    expect(
                        JSON.stringify({
                            message: failure.message,
                            details: failure.details,
                        }),
                    ).not.toContain(marker);
                }
            }
        } finally {
            store.close();
            vault.close();
        }
    });

    test("the credential cache lives in memory and expires", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const store = createKeychainCredentialStore({ dataDir, keychain });
        const nowSec = Math.floor(Date.now() / 1000);

        store.setCache("usage:anthropic", "cached-report", nowSec + 60);
        expect(store.getCache("usage:anthropic")).toBe("cached-report");

        store.setCache("usage:openai", "stale-report", nowSec - 1);
        expect(store.getCache("usage:openai")).toBeNull();
        expect(store.getCache("usage:openai", { includeExpired: true })).toBe("stale-report");

        store.cleanExpiredCache();
        expect(store.getCache("usage:openai", { includeExpired: true })).toBeNull();

        const fresh = createKeychainCredentialStore({ dataDir, keychain });
        expect(fresh.getCache("usage:anthropic")).toBeNull();
        fresh.close();
        store.close();
    });

    test("a live selector follows the current binding without a new storage", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const first = vault.create("openai", apiKeyCredential());
        const second = vault.create("openai", apiKeyCredential(OTHER_KEY));
        let bound = first.reference;

        const storage = await vault.authStorage(() => [bound]);
        expect(storage.credentials.list().map(row => row.id)).toEqual([
            vault.read(first.reference).rowId,
        ]);

        bound = second.reference;
        await storage.credentials.reload();

        expect(storage.credentials.list().map(row => row.id)).toEqual([
            vault.read(second.reference).rowId,
        ]);
        storage.close();
        vault.close();
    });

    test("a changed selection is reported once as an external change", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const first = vault.create("openai", apiKeyCredential());
        const second = vault.create("openai", apiKeyCredential(OTHER_KEY));
        let bound = first.reference;
        const store = createKeychainCredentialStore({
            dataDir,
            keychain,
            references: () => [bound],
        });
        store.listAuthCredentials();

        expect(store.pollExternalChanges?.()).toBe(false);
        bound = second.reference;
        expect(store.pollExternalChanges?.()).toBe(true);
        expect(store.pollExternalChanges?.()).toBe(false);
        store.close();
        vault.close();
    });

    test("a payload rotated under an unchanged reference is an external change", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const store = createKeychainCredentialStore({
            dataDir,
            keychain,
            references: [stored.reference],
        });
        store.listAuthCredentials();
        expect(store.pollExternalChanges?.()).toBe(false);

        // Neither the binding nor the index moves when another process refreshes the
        // grant; only the stored bytes do.
        rewritePayload(keychain, stored.reference, "anthropic", oauthCredential("rotated"));

        expect(store.pollExternalChanges?.()).toBe(true);
        expect(store.pollExternalChanges?.()).toBe(false);
        expect(store.listAuthCredentials("anthropic")[0]?.credential).toMatchObject({
            type: "oauth",
            access: "rotated",
        });
        store.close();
        vault.close();
    });

    test("an item removed under an unchanged reference is an external change, then fails", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const store = createKeychainCredentialStore({
            dataDir,
            keychain,
            references: [stored.reference],
        });
        store.listAuthCredentials();
        expect(store.pollExternalChanges?.()).toBe(false);

        keychain.items.delete(stored.reference);

        expect(store.pollExternalChanges?.()).toBe(true);
        expect(() => store.listAuthCredentials("anthropic")).toThrow(CredentialError);
        store.close();
        vault.close();
    });

    test("every SDK read and write goes through the noninteractive Keychain view", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const original = oauthCredential();
        const stored = vault.create("anthropic", original);
        const { rowId } = vault.read(stored.reference);
        // Storing and reading a credential is a command the human asked for and may
        // answer a dialog for; the refresh path that follows must not be.
        expect(new Set(keychain.views)).toEqual(new Set(["interactive"]));
        const store = createKeychainCredentialStore({ dataDir, keychain });
        keychain.views.length = 0;

        store.listAuthCredentials("anthropic");
        store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(original) ?? "",
            oauthCredential("refreshed-access"),
        );

        expect(keychain.views).not.toHaveLength(0);
        expect(new Set(keychain.views)).toEqual(new Set(["noninteractive"]));
        store.close();
        vault.close();
    });

    test("saving a refreshed grant whose row is gone fails instead of reporting success", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("anthropic", oauthCredential());
        const { rowId } = vault.read(stored.reference);
        const store = createKeychainCredentialStore({ dataDir, keychain });
        vault.delete(stored.reference);

        expect(() => store.updateAuthCredential(rowId, oauthCredential("refreshed"))).toThrow(
            CredentialError,
        );
        expect(keychain.items.has(stored.reference)).toBe(false);
        store.close();
        vault.close();
    });
});
