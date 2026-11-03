import type { AuthCredential } from "@oh-my-pi/pi-ai";

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemorySecretStore } from "./testing/memory-secret-store.ts";

import { lockedConnection, withCredentialLock } from "./coordination.ts";
import { CredentialError } from "./errors.ts";
import { CredentialIndex } from "./index-rows.ts";
import { encodeCredentialPayload } from "./payload.ts";
import { createMemorySecretStore, keychainFailure } from "./testing/memory-secret-store.ts";
import { openCredentialVault } from "./vault.ts";

const API_KEY = "pico-fake-api-key-ZmFpbHVyZQ";

const apiKeyCredential = (key = API_KEY): AuthCredential => ({ type: "api_key", key });

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-credential-failures-")));
    roots.push(root);
    return join(root, "Pico");
}

function thrownBy(action: () => unknown): unknown {
    try {
        action();
        return undefined;
    } catch (error) {
        return error;
    }
}

/**
 * The state a process killed mid-creation leaves behind: an unpublished row whose
 * attempt can no longer finish, and the Keychain item its write may already have
 * landed. `itemWritten` distinguishes a crash before the write from one after it.
 */
function interruptedCreation(
    dataDir: string,
    keychain: MemorySecretStore,
    options: { itemWritten: boolean },
): string {
    const reference = randomUUID();
    withCredentialLock(dataDir, () => {
        const index = new CredentialIndex(lockedConnection(dataDir));
        index.ensureSchema();
        index.insertPending({
            reference,
            provider: "openai",
            kind: "api_key",
            attemptExpiresAtMs: Date.now() - 1,
        });
    });
    if (options.itemWritten) {
        keychain.items.set(
            reference,
            encodeCredentialPayload({
                reference,
                provider: "openai",
                kind: "api_key",
                credential: apiKeyCredential(),
            }),
        );
    }
    return reference;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 credential storage failures", () => {
    test("a Keychain write that fails publishes no credential at all", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        keychain.failNext("set", keychainFailure("KEYCHAIN_LOCKED", "set", -25308));

        const failure = thrownBy(() => vault.create("openai", apiKeyCredential()));

        expect(failure).toBeInstanceOf(CredentialError);
        expect((failure as CredentialError).code).toBe("KEYCHAIN_LOCKED");
        expect(String((failure as CredentialError).message)).not.toContain(API_KEY);
        expect(vault.list()).toEqual([]);
        expect(keychain.items.size).toBe(0);
        vault.close();
    });

    for (const cleanupDenied of [false, true]) {
        test(`a failed post-write creation ${cleanupDenied ? "retains retryable cleanup" : "removes its item"}`, () => {
            const dataDir = temporaryDataDir();
            const keychain = createMemorySecretStore();
            const vault = openCredentialVault({ dataDir, keychain });
            const write = keychain.set.bind(keychain);
            let reference = "";
            keychain.set = (target, payload) => {
                reference = target;
                write(target, payload);
                if (cleanupDenied)
                    keychain.failNext(
                        "delete",
                        keychainFailure("KEYCHAIN_ACCESS_DENIED", "delete", -25293),
                    );
                throw keychainFailure("KEYCHAIN_FAILED", "set");
            };

            const failure = thrownBy(() => vault.create("openai", apiKeyCredential()));

            expect(failure).toBeInstanceOf(CredentialError);
            if (cleanupDenied) {
                expect(vault.metadata(reference)?.state).toBe("deleting");
                expect((failure as CredentialError).details).toMatchObject({ reference });
                expect(vault.delete(reference)).toBe(true);
            } else {
                expect(vault.metadata(reference)).toBeUndefined();
            }
            expect(keychain.items.has(reference)).toBe(false);
            vault.close();
        });
    }

    test("a creation overtaken by pending recovery never forgets a late Keychain write", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const write = keychain.set.bind(keychain);
        let reference = "";
        keychain.set = (target, payload) => {
            if (!reference) {
                reference = target;
                withCredentialLock(dataDir, () => {
                    lockedConnection(dataDir).run(
                        "UPDATE credentials SET attempt_expires_at_ms = 0 WHERE reference = ?",
                        [target],
                    );
                });
                const peer = openCredentialVault({ dataDir, keychain });
                try {
                    peer.create("anthropic", apiKeyCredential("FAKE-peer-key"));
                } finally {
                    peer.close();
                }
            }
            write(target, payload);
        };

        const failure = thrownBy(() => vault.create("openai", apiKeyCredential()));

        expect(failure).toBeInstanceOf(CredentialError);
        expect(keychain.items.has(reference)).toBe(false);
        expect((failure as CredentialError).code).toBe("CONFLICT");
        vault.close();
    });

    test("the Keychain write lands before any other process can see the credential", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const observed: string[][] = [];
        const write = keychain.set.bind(keychain);
        keychain.set = (reference, payload) => {
            const observer = openCredentialVault({ dataDir, keychain });
            observed.push(observer.list().map(item => item.reference));
            observer.close();
            write(reference, payload);
        };

        const stored = vault.create("openai", apiKeyCredential());

        expect(observed).toEqual([[]]);
        const observer = openCredentialVault({ dataDir, keychain });
        expect(observer.list().map(item => item.reference)).toEqual([stored.reference]);
        observer.close();
        vault.close();
    });

    test("an interrupted creation is never selectable", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = interruptedCreation(dataDir, keychain, { itemWritten: true });
        const vault = openCredentialVault({ dataDir, keychain });

        expect(vault.list()).toEqual([]);
        expect(vault.metadata(reference)).toBeUndefined();
        expect(thrownBy(() => vault.read(reference))).toBeInstanceOf(CredentialError);
        vault.close();
    });

    test("the next credential operation cleans up an abandoned creation and its item", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = interruptedCreation(dataDir, keychain, { itemWritten: true });
        const vault = openCredentialVault({ dataDir, keychain });

        const stored = vault.create("openai", apiKeyCredential());

        expect(keychain.items.has(reference)).toBe(false);
        expect(vault.list()).toEqual([stored]);
        expect(keychain.deletes).toContain(reference);
        vault.close();
    });

    test("recovery of an abandoned creation touches only that Pico-owned item", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const kept = vault.create("openai", apiKeyCredential());
        const abandoned = interruptedCreation(dataDir, keychain, { itemWritten: false });
        keychain.items.set("unrelated-item", "not pico's");

        vault.create("anthropic", apiKeyCredential("pico-fake-api-key-b3RoZXI"));

        expect(keychain.items.has(kept.reference)).toBe(true);
        expect(keychain.items.has("unrelated-item")).toBe(true);
        expect(vault.metadata(abandoned)).toBeUndefined();
        expect(keychain.deletes).not.toContain("unrelated-item");
        vault.close();
    });

    test("a Keychain deletion that fails keeps a deleting record naming the reference", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("openai", apiKeyCredential());
        keychain.failNext("delete", keychainFailure("KEYCHAIN_ACCESS_DENIED", "delete", -25293));

        const failure = thrownBy(() => vault.delete(stored.reference));

        expect((failure as CredentialError).code).toBe("KEYCHAIN_ACCESS_DENIED");
        expect((failure as CredentialError).details).toMatchObject({ reference: stored.reference });
        expect(vault.metadata(stored.reference)?.state).toBe("deleting");
        expect(keychain.items.has(stored.reference)).toBe(true);
        vault.close();
    });

    test("retrying the same deletion finishes it", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("openai", apiKeyCredential());
        keychain.failNext("delete", keychainFailure("KEYCHAIN_LOCKED", "delete", -25308));
        thrownBy(() => vault.delete(stored.reference));

        expect(vault.delete(stored.reference)).toBe(true);
        expect(vault.metadata(stored.reference)).toBeUndefined();
        expect(keychain.items.has(stored.reference)).toBe(false);
        vault.close();
    });

    test("a deleting row survives a restart and is still finishable", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const first = openCredentialVault({ dataDir, keychain });
        const stored = first.create("openai", apiKeyCredential());
        keychain.failNext("delete", keychainFailure("KEYCHAIN_LOCKED", "delete", -25308));
        thrownBy(() => first.delete(stored.reference));
        first.close();

        const second = openCredentialVault({ dataDir, keychain });

        expect(second.metadata(stored.reference)?.state).toBe("deleting");
        expect(second.delete(stored.reference)).toBe(true);
        second.close();
    });

    test("an item a human removed by hand is unavailable, never another account", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const sibling = vault.create("openai", apiKeyCredential("pico-fake-api-key-c2libGluZw"));
        const stored = vault.create("openai", apiKeyCredential());
        keychain.items.delete(stored.reference);

        const failure = thrownBy(() => vault.read(stored.reference));

        expect((failure as CredentialError).code).toBe("UNAVAILABLE");
        expect((failure as CredentialError).details).toMatchObject({
            reference: stored.reference,
            provider: "openai",
        });
        expect(JSON.stringify((failure as CredentialError).details)).not.toContain(
            sibling.reference,
        );
        vault.close();
    });

    test("denied, locked and dialog-requiring Keychain access stay distinguishable", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("openai", apiKeyCredential());

        keychain.failNext("get", keychainFailure("KEYCHAIN_ACCESS_DENIED", "get", -25293));
        expect((thrownBy(() => vault.read(stored.reference)) as CredentialError).code).toBe(
            "KEYCHAIN_ACCESS_DENIED",
        );

        keychain.failNext("get", keychainFailure("KEYCHAIN_LOCKED", "get", -25308));
        expect((thrownBy(() => vault.read(stored.reference)) as CredentialError).code).toBe(
            "KEYCHAIN_LOCKED",
        );

        keychain.failNext("get", keychainFailure("KEYCHAIN_UI_REQUIRED", "get", -25308));
        const needsDialog = thrownBy(() => vault.read(stored.reference)) as CredentialError;
        expect(needsDialog.code).toBe("FAILED_PRECONDITION");
        expect(needsDialog.retryable).toBe(false);
        expect(needsDialog.message).toContain("--allow-keychain-ui");
        expect(needsDialog.details).toMatchObject({
            keychain: "KEYCHAIN_UI_REQUIRED",
            status: -25308,
        });

        keychain.failNext("get", keychainFailure("KEYCHAIN_UNSUPPORTED_PLATFORM", "get"));
        expect((thrownBy(() => vault.read(stored.reference)) as CredentialError).code).toBe(
            "FAILED_PRECONDITION",
        );
        vault.close();
    });

    test("a payload whose identity is not its reference is refused as malformed", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const stored = vault.create("openai", apiKeyCredential());
        const other = randomUUID();
        keychain.items.set(
            stored.reference,
            encodeCredentialPayload({
                reference: other,
                provider: "openai",
                kind: "api_key",
                credential: apiKeyCredential(),
            }),
        );

        const failure = thrownBy(() => vault.read(stored.reference)) as CredentialError;

        expect(failure.code).toBe("FAILED_PRECONDITION");
        expect(failure.details).toMatchObject({ reference: stored.reference });
        expect(JSON.stringify(failure.details)).not.toContain(API_KEY);
        vault.close();
    });

    test("an aborted creation publishes nothing", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });
        const controller = new AbortController();
        controller.abort();

        const failure = thrownBy(() =>
            vault.create("openai", apiKeyCredential(), { signal: controller.signal }),
        );

        expect((failure as CredentialError).code).toBe("CANCELLED");
        expect(vault.list()).toEqual([]);
        expect(keychain.items.size).toBe(0);
        vault.close();
    });

    test("an empty or NUL-bearing API key never reaches the Keychain", () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const vault = openCredentialVault({ dataDir, keychain });

        for (const key of ["", "abc\u0000def"]) {
            const failure = thrownBy(() => vault.create("openai", apiKeyCredential(key)));
            expect((failure as CredentialError).code).toBe("INVALID_ARGUMENT");
        }
        expect(keychain.writes).toEqual([]);
        expect(vault.list()).toEqual([]);
        vault.close();
    });
});
