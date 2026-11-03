import type { AuthCredential, OAuthCredential } from "@oh-my-pi/pi-ai";

import { hasRefreshLeases } from "@oh-my-pi/pi-ai";
import { describe, expect, test } from "bun:test";

import { createMemoryCredentialStore } from "./memory-store.ts";

const apiKey: AuthCredential = { type: "api_key", key: "staged-fake-key", source: "login" };

const grant = (accountId: string, access: string): OAuthCredential => ({
    type: "oauth",
    access,
    refresh: `refresh-${access}`,
    expires: 4_000_000_000_000,
    accountId,
});

describe("proposal.0009 the login staging store", () => {
    test("a staged credential reads back under a real row id", async () => {
        const store = createMemoryCredentialStore();

        const stored = await store.upsertAuthCredential("openai-codex", grant("a", "first"));

        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBeGreaterThan(0);
        expect(store.listAuthCredentials("openai-codex")).toEqual(stored);
        store.close();
    });

    test("row ids keep increasing so a staged row is never mistaken for another", async () => {
        const store = createMemoryCredentialStore();

        const first = await store.upsertAuthCredential("openai-codex", grant("a", "first"));
        const second = await store.upsertAuthCredential("anthropic", apiKey);

        expect(second[0]!.id).toBeGreaterThan(first[0]!.id);
        store.close();
    });

    test("upserting the same account replaces its row rather than adding a second", async () => {
        const store = createMemoryCredentialStore();
        const first = await store.upsertAuthCredential("openai-codex", grant("a", "first"));

        const second = await store.upsertAuthCredential("openai-codex", grant("a", "rotated"));

        expect(second).toHaveLength(1);
        expect(second[0]?.id).toBe(first[0]!.id);
        expect(second[0]?.credential).toMatchObject({ type: "oauth", access: "rotated" });
        store.close();
    });

    test("a different account for the same provider is stored beside the first", async () => {
        const store = createMemoryCredentialStore();
        await store.upsertAuthCredential("openai-codex", grant("a", "first"));

        await store.upsertAuthCredential("openai-codex", grant("b", "second"));

        expect(store.listAuthCredentials("openai-codex")).toHaveLength(2);
        store.close();
    });

    test("replacing a provider's rows leaves only the new ones active", async () => {
        const store = createMemoryCredentialStore();
        await store.upsertAuthCredential("openai-codex", grant("a", "first"));

        const replaced = await store.replaceAuthCredentials("openai-codex", [grant("b", "only")]);

        expect(replaced).toHaveLength(1);
        expect(replaced[0]?.credential).toMatchObject({ type: "oauth", accountId: "b" });
        expect(store.listAuthCredentials("openai-codex")).toEqual(replaced);
        store.close();
    });

    test("a disabled row leaves the active list and cannot be disabled twice", async () => {
        const store = createMemoryCredentialStore();
        const stored = await store.upsertAuthCredential("openai-codex", grant("a", "first"));
        const id = stored[0]!.id;

        expect(await store.deleteAuthCredential(id, "staged attempt failed")).toBe(true);
        expect(store.listAuthCredentials("openai-codex")).toEqual([]);
        expect(await store.deleteAuthCredential(id, "staged attempt failed")).toBe(false);
        store.close();
    });

    test("it claims no capability it does not have", () => {
        const store = createMemoryCredentialStore();

        expect(hasRefreshLeases(store)).toBe(false);
        expect(store.tryAcquireCredentialRefreshLease).toBeUndefined();
        expect(store.getCredentialBlock).toBeUndefined();
        expect(store.recordUsageSnapshots).toBeUndefined();
        expect(store.refreshOAuthCredential).toBeUndefined();
        expect(store.listDisabledCredentials).toBeUndefined();
        store.close();
    });

    test("closing it drops every staged credential and cache entry", async () => {
        const store = createMemoryCredentialStore();
        await store.upsertAuthCredential("openai-codex", grant("a", "first"));
        store.setCache("probe", "value", Math.floor(Date.now() / 1000) + 60);

        store.close();

        expect(store.listAuthCredentials()).toEqual([]);
        expect(store.getCache("probe")).toBeNull();
    });
});
