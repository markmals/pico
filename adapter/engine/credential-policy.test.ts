import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemorySecretStore } from "../credentials/testing/memory-secret-store.ts";
import type { PicoCredentials } from "./credential-policy.ts";

import { CredentialError } from "../credentials/errors.ts";
import { encodeCredentialPayload } from "../credentials/payload.ts";
import { createMemorySecretStore } from "../credentials/testing/memory-secret-store.ts";
import { openCredentialVault } from "../credentials/vault.ts";
import { readSettings, writeSettings } from "../settings/settings-store.ts";
import { openPicoCredentials } from "./credential-policy.ts";

/** A provider the SDK knows and can authorize from the environment on its own. */
const AMBIENT_PROVIDER = "anthropic";
const AMBIENT_VARIABLE = "ANTHROPIC_API_KEY";
/** A provider the SDK does not know, standing in for a scripted test provider. */
const TEST_PROVIDER = "pico-test";

const roots: string[] = [];
const opened: PicoCredentials[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-policy-")));
    roots.push(root);
    return join(root, "Pico");
}

/** Stores a credential for `provider` without selecting it, and returns its reference. */
async function store(
    dataDir: string,
    keychain: MemorySecretStore,
    provider: string,
    key: string,
): Promise<string> {
    const vault = openCredentialVault({ dataDir, keychain });
    try {
        return vault.create(provider, { type: "api_key", key }).reference;
    } finally {
        vault.close();
    }
}

/** Replaces the secret behind an existing reference, as a provider rotation does. */
function rewrite(
    keychain: MemorySecretStore,
    reference: string,
    provider: string,
    key: string,
): void {
    keychain.items.set(
        reference,
        encodeCredentialPayload({
            reference,
            provider,
            kind: "api_key",
            credential: { type: "api_key", key, source: "login" },
        }),
    );
}

function bind(dataDir: string, bindings: Record<string, string>): void {
    const state = readSettings(dataDir);
    const item = "item" in state ? state.item : undefined;
    writeSettings(dataDir, {
        defaultModel: item?.defaultModel ?? null,
        defaultThinking: item?.defaultThinking ?? null,
        autoBackground: item?.autoBackground ?? null,
        providerCredentials: bindings,
    });
}

async function open(dataDir: string, keychain: MemorySecretStore): Promise<PicoCredentials> {
    const credentials = await openPicoCredentials({ dataDir, keychain });
    opened.push(credentials);
    return credentials;
}

afterEach(() => {
    for (const credentials of opened.splice(0)) credentials.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 resolving a provider's credential", () => {
    test("a bound credential serves the request", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, TEST_PROVIDER, "bound-key");
        bind(dataDir, { [TEST_PROVIDER]: reference });

        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("bound-key");
    });

    test("a stored credential that is not selected authorizes nothing", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        await store(dataDir, keychain, TEST_PROVIDER, "unselected-key");

        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBeUndefined();
    });

    test("a sibling credential never serves a provider bound to another one", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const selected = await store(dataDir, keychain, TEST_PROVIDER, "selected-key");
        await store(dataDir, keychain, TEST_PROVIDER, "sibling-key");
        bind(dataDir, { [TEST_PROVIDER]: selected });

        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("selected-key");
    });

    test("a selected credential whose Keychain item is gone fails without a substitute", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, TEST_PROVIDER, "vanishing-key");
        bind(dataDir, { [TEST_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("vanishing-key");

        // The human removed the item in Keychain Access; the metadata row is untouched.
        keychain.items.delete(reference);

        const failure = await registry
            .getApiKeyForProvider(TEST_PROVIDER)
            .then(() => undefined)
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(CredentialError);
        expect((failure as CredentialError).details).toMatchObject({ reference });
    });

    test("a rotated Keychain payload serves the next request, under the same reference", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, TEST_PROVIDER, "first-key");
        bind(dataDir, { [TEST_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("first-key");

        // The same credential, its secret replaced: neither the reference nor the index moved.
        rewrite(keychain, reference, TEST_PROVIDER, "rotated-key");

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("rotated-key");
    });
});

describe("proposal.0009 bindings are global and reread per request", () => {
    test("changing the binding changes the next request, with nothing rebuilt or restarted", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const first = await store(dataDir, keychain, TEST_PROVIDER, "first-key");
        const second = await store(dataDir, keychain, TEST_PROVIDER, "second-key");
        bind(dataDir, { [TEST_PROVIDER]: first });
        const { registry } = await open(dataDir, keychain);
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("first-key");

        bind(dataDir, { [TEST_PROVIDER]: second });

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("second-key");
    });

    test("a credential already resolved for a request in flight is not changed under it", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const first = await store(dataDir, keychain, TEST_PROVIDER, "first-key");
        const second = await store(dataDir, keychain, TEST_PROVIDER, "second-key");
        bind(dataDir, { [TEST_PROVIDER]: first });
        const { registry } = await open(dataDir, keychain);

        const issued = await registry.getApiKeyForProvider(TEST_PROVIDER);
        bind(dataDir, { [TEST_PROVIDER]: second });

        expect(issued).toBe("first-key");
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("second-key");
    });

    test("disconnecting a provider stops its next request", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, TEST_PROVIDER, "bound-key");
        bind(dataDir, { [TEST_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("bound-key");

        bind(dataDir, {});

        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBeUndefined();
    });

    test("an unusable settings file fails the next request instead of keeping the last binding", async () => {
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, TEST_PROVIDER, "bound-key");
        bind(dataDir, { [TEST_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);
        expect(await registry.getApiKeyForProvider(TEST_PROVIDER)).toBe("bound-key");

        await Bun.write(join(dataDir, "settings.json"), '{"version":2,"defaultModel":5}');

        expect(registry.getApiKeyForProvider(TEST_PROVIDER)).rejects.toThrow();
    });
});

describe("proposal.0009 no ambient credential authorizes a provider", () => {
    const previous = process.env[AMBIENT_VARIABLE];

    afterEach(() => {
        if (previous === undefined) delete process.env[AMBIENT_VARIABLE];
        else process.env[AMBIENT_VARIABLE] = previous;
    });

    test("an environment key does not authorize a provider Pico has not bound", async () => {
        process.env[AMBIENT_VARIABLE] = "environment-key";
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();

        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(AMBIENT_PROVIDER)).toBeUndefined();
    });

    test("an environment key does not stand in for a bound credential that cannot serve", async () => {
        process.env[AMBIENT_VARIABLE] = "environment-key";
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, AMBIENT_PROVIDER, "bound-key");
        bind(dataDir, { [AMBIENT_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);
        keychain.items.delete(reference);

        const resolved = await registry
            .getApiKeyForProvider(AMBIENT_PROVIDER)
            .catch((error: unknown) => error);

        expect(resolved).not.toBe("environment-key");
    });

    test("a selected environment-shaped API key is used literally", async () => {
        process.env[AMBIENT_VARIABLE] = "ambient-other";
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, AMBIENT_PROVIDER, AMBIENT_VARIABLE);
        bind(dataDir, { [AMBIENT_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(AMBIENT_PROVIDER)).toBe(AMBIENT_VARIABLE);
    });

    test("a selected command-shaped API key never executes", async () => {
        const dataDir = temporaryDataDir();
        const executed = join(dataDir, "unexpected-command");
        const literal = `!touch ${JSON.stringify(executed)}; printf FAKE-command-output`;
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, AMBIENT_PROVIDER, literal);
        bind(dataDir, { [AMBIENT_PROVIDER]: reference });
        const { registry } = await open(dataDir, keychain);

        const resolved = await registry.getApiKeyForProvider(AMBIENT_PROVIDER);

        expect(existsSync(executed)).toBe(false);
        expect(resolved).toBe(literal);
    });

    test("a provider Pico has bound is enabled again, environment key or not", async () => {
        process.env[AMBIENT_VARIABLE] = "environment-key";
        const dataDir = temporaryDataDir();
        const keychain = createMemorySecretStore();
        const reference = await store(dataDir, keychain, AMBIENT_PROVIDER, "bound-key");
        bind(dataDir, { [AMBIENT_PROVIDER]: reference });

        const { registry } = await open(dataDir, keychain);

        expect(await registry.getApiKeyForProvider(AMBIENT_PROVIDER)).toBe("bound-key");
    });
});
