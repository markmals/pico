import type { AuthCredential, OAuthCredential } from "@oh-my-pi/pi-ai";

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemorySecretStore } from "./testing/memory-secret-store.ts";

import { writeSettings } from "../settings/settings-store.ts";
import { CredentialError } from "./errors.ts";
import { createMemorySecretStore, keychainFailure } from "./testing/memory-secret-store.ts";
import { openCredentialVault } from "./vault.ts";

const API_KEY = "pico-fake-api-key-ZHVtbXk";
const SECOND_API_KEY = "pico-fake-api-key-c2Vjb25k";

const apiKeyCredential = (key = API_KEY): AuthCredential => ({ type: "api_key", key });

const oauthCredential = (): OAuthCredential => ({
    type: "oauth",
    access: "pico-fake-access-token",
    refresh: "pico-fake-refresh-token",
    expires: Date.now() + 3_600_000,
    email: "person@example.com",
    accountId: "account-1",
    orgId: "org-1",
    orgName: "Org One",
});

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-credentials-")));
    roots.push(root);
    return join(root, "Pico");
}

function openVault(dataDir: string, keychain: MemorySecretStore) {
    const vault = openCredentialVault({ dataDir, keychain });
    return vault;
}

function thrownBy(action: () => unknown): unknown {
    try {
        action();
        return undefined;
    } catch (error) {
        return error;
    }
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 the credential vault", () => {
    test("an absent index reads as empty without creating a single file", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        expect(vault.revision()).toBe("none");
        expect(vault.list()).toEqual([]);
        expect(vault.metadata("f4f4e8c4-0000-4000-8000-000000000000")).toBeUndefined();
        expect(existsSync(dataDir)).toBe(false);
        expect(keychain.reads).toEqual([]);
        vault.close();
    });

    test("a stored API key is an active credential identified by an opaque UUID", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const stored = vault.create("openai", apiKeyCredential());

        expect(stored.reference).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(stored).toEqual({
            reference: stored.reference,
            provider: "openai",
            kind: "api_key",
            state: "active",
        });
        expect(keychain.items.has(stored.reference)).toBe(true);
        vault.close();
    });

    test("the stored payload carries the credential and its own identity", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const stored = vault.create("openai", apiKeyCredential());
        const payload = JSON.parse(keychain.items.get(stored.reference) ?? "");

        expect(payload).toEqual({
            version: 1,
            reference: stored.reference,
            provider: "openai",
            kind: "api_key",
            credential: { type: "api_key", key: API_KEY, source: "login" },
        });
        vault.close();
    });

    test("a stored API key outranks an ambient environment key for its provider", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const stored = vault.create("openai", apiKeyCredential());

        // The SDK's cascade puts a login-sourced stored key ahead of getEnvApiKey and
        // any other stored key, so this marker is what keeps OPENAI_API_KEY out.
        expect(vault.read(stored.reference).credential).toMatchObject({ source: "login" });
    });

    test("no byte of the index database or its journal holds the secret", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        vault.create("openai", apiKeyCredential());
        vault.create("anthropic", oauthCredential());
        vault.close();

        for (const entry of readdirSync(dataDir)) {
            const bytes = readFileSync(join(dataDir, entry)).toString("binary");
            expect(bytes).not.toContain(API_KEY);
            expect(bytes).not.toContain("pico-fake-access-token");
            expect(bytes).not.toContain("pico-fake-refresh-token");
        }
    });

    test("a stored credential reads back with its SDK row id and credential", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const stored = vault.create("openai", apiKeyCredential());
        const read = vault.read(stored.reference);

        expect(read.metadata).toEqual(stored);
        expect(read.rowId).toBeGreaterThan(0);
        expect(read.credential).toEqual({ type: "api_key", key: API_KEY, source: "login" });
        vault.close();
    });

    test("OAuth account metadata is projected without any token material", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const stored = vault.create("anthropic", oauthCredential());

        expect(stored).toEqual({
            reference: stored.reference,
            provider: "anthropic",
            kind: "oauth",
            state: "active",
            email: "person@example.com",
            accountId: "account-1",
            orgId: "org-1",
            orgName: "Org One",
        });
        expect(JSON.stringify(vault.list())).not.toContain("pico-fake-access-token");
        vault.close();
    });

    test("a reopened vault lists and reads what the previous process stored", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const first = openVault(dataDir, keychain);
        const stored = first.create("openai", apiKeyCredential());
        first.close();

        const second = openVault(dataDir, keychain);

        expect(second.list()).toEqual([stored]);
        expect(second.read(stored.reference).credential).toEqual({
            type: "api_key",
            key: API_KEY,
            source: "login",
        });
        second.close();
    });

    test("listing and metadata are index reads that never touch the Keychain", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const stored = vault.create("openai", apiKeyCredential());
        keychain.reads.length = 0;

        expect(vault.list()).toEqual([stored]);
        expect(vault.metadata(stored.reference)).toEqual(stored);
        expect(vault.revision()).not.toBe("none");
        expect(keychain.reads).toEqual([]);
        vault.close();
    });

    test("listing restricts to one provider without touching another's rows", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const openai = vault.create("openai", apiKeyCredential());
        vault.create("anthropic", oauthCredential());

        expect(vault.list("openai")).toEqual([openai]);
        expect(vault.list("mistral")).toEqual([]);
        vault.close();
    });

    test("every index mutation moves the revision, and a stale one is a conflict", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);

        const first = vault.create("openai", apiKeyCredential());
        const afterFirst = vault.revision();
        expect(afterFirst).not.toBe("none");

        vault.create("anthropic", oauthCredential());
        expect(vault.revision()).not.toBe(afterFirst);

        const conflict = thrownBy(() =>
            vault.create("openai", apiKeyCredential(SECOND_API_KEY), { ifRevision: afterFirst }),
        );
        expect(conflict).toBeInstanceOf(CredentialError);
        expect((conflict as CredentialError).code).toBe("CONFLICT");
        expect(vault.list("openai")).toEqual([first]);
        vault.close();
    });

    test("deleting an unreferenced credential removes its row and its exact item", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const stored = vault.create("openai", apiKeyCredential());
        const sibling = vault.create("openai", apiKeyCredential(SECOND_API_KEY));

        expect(vault.delete(stored.reference)).toBe(true);
        expect(keychain.items.has(stored.reference)).toBe(false);
        expect(vault.list()).toEqual([sibling]);
        expect(keychain.items.has(sibling.reference)).toBe(true);
        vault.close();
    });

    test("deleting a reference that is already gone is an unchanged, retryable receipt", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const stored = vault.create("openai", apiKeyCredential());
        vault.delete(stored.reference);
        const settled = vault.revision();

        expect(vault.delete(stored.reference)).toBe(false);
        expect(vault.revision()).toBe(settled);
        vault.close();
    });

    test("deleting a credential a provider binding still names is refused by name", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const stored = vault.create("openai", apiKeyCredential());
        writeSettings(dataDir, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            providerCredentials: { openai: stored.reference },
        });

        const refusal = thrownBy(() => vault.delete(stored.reference));

        expect(refusal).toBeInstanceOf(CredentialError);
        expect((refusal as CredentialError).code).toBe("FAILED_PRECONDITION");
        expect((refusal as CredentialError).details).toMatchObject({
            reference: stored.reference,
            provider: "openai",
        });
        expect(keychain.items.has(stored.reference)).toBe(true);
        expect(vault.metadata(stored.reference)?.state).toBe("active");
        vault.close();
    });

    test("storing an OAuth grant keeps the provider's API key and its siblings", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const apiKey = vault.create("anthropic", apiKeyCredential());
        const sibling = vault.create("anthropic", oauthCredential());

        const added = vault.create("anthropic", {
            ...oauthCredential(),
            accountId: "account-2",
            email: "other@example.com",
        });

        expect(
            vault
                .list("anthropic")
                .map(item => item.reference)
                .sort(),
        ).toEqual([apiKey.reference, sibling.reference, added.reference].sort());
        expect(vault.read(apiKey.reference).credential).toEqual({
            type: "api_key",
            key: API_KEY,
            source: "login",
        });
        vault.close();
    });

    test("creating a credential binds nothing and leaves saved defaults alone", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        writeSettings(dataDir, {
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: null,
            providerCredentials: {},
        });
        const settingsBefore = readFileSync(join(dataDir, "settings.json"));
        const vault = openVault(dataDir, keychain);

        vault.create("openai", apiKeyCredential());

        expect(readFileSync(join(dataDir, "settings.json"))).toEqual(settingsBefore);
        vault.close();
    });

    test("a credential left in the deleting state is visible but never resolvable", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        const stored = vault.create("openai", apiKeyCredential());
        keychain.failNext("delete", keychainFailure("KEYCHAIN_LOCKED", "delete"));

        expect(thrownBy(() => vault.delete(stored.reference))).toBeInstanceOf(CredentialError);
        expect(vault.metadata(stored.reference)?.state).toBe("deleting");
        expect(vault.list().map(item => item.state)).toEqual(["deleting"]);

        const unusable = thrownBy(() => vault.read(stored.reference));
        expect((unusable as CredentialError).code).toBe("NOT_FOUND");
        vault.close();
    });

    test("an unknown reference is a typed not-found rather than a sibling credential", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openVault(dataDir, keychain);
        vault.create("openai", apiKeyCredential());

        const missing = thrownBy(() => vault.read("3f1c0f3a-0000-4000-8000-00000000dead"));

        expect(missing).toBeInstanceOf(CredentialError);
        expect((missing as CredentialError).code).toBe("NOT_FOUND");
        vault.close();
    });
});
