import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Cleanups } from "../../engine/testing/session-fixture.ts";
import type { CommandHandlers as Handlers } from "./handlers.ts";

import { keychainFailure } from "../../credentials/testing/memory-secret-store.ts";
import { readSettings, writeSettings } from "../../settings/settings-store.ts";
import {
    credentialsCreateOutput,
    credentialsDeleteOutput,
    credentialsGetOutput,
    credentialsListOutput,
} from "../result-schemas.ts";
import { input, rejection, testHandlers, testVault } from "./testing.ts";

const FAKE_KEY = "FAKE-pico-0009-not-a-provider-credential";

async function list(handlers: Handlers, options: Record<string, string | boolean> = {}) {
    return credentialsListOutput.parse({
        apiVersion: 1,
        ...(await handlers["credentials list"](input(options))),
    });
}

async function get(handlers: Handlers, reference: string, options = {}) {
    return credentialsGetOutput.parse({
        apiVersion: 1,
        ...(await handlers["credentials get"](input(options, { reference }))),
    });
}

async function create(handlers: Handlers, options: Record<string, string | boolean>) {
    return credentialsCreateOutput.parse({
        apiVersion: 1,
        ...(await handlers["credentials create"](input({ stdin: true, ...options }))),
    });
}

async function remove(
    handlers: Handlers,
    reference: string,
    options: Record<string, string | boolean> = {},
) {
    return credentialsDeleteOutput.parse({
        apiVersion: 1,
        ...(await handlers["credentials delete"](input(options, { reference }))),
    });
}

/** Settings carrying one provider binding, with proposal 0008's fields left as saved. */
function bind(dataDir: string, bindings: Record<string, string>) {
    writeSettings(dataDir, {
        defaultModel: null,
        defaultThinking: null,
        autoBackground: null,
        providerCredentials: bindings,
    });
}

describe("proposal.0009 pico credentials create", () => {
    test("a key read from stdin is stored, and the receipt holds no key", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });

        const receipt = await create(handlers, { provider: "openai" });

        assert.equal(receipt.changed, true);
        assert.equal(receipt.stored, true);
        assert.equal(receipt.dryRun, false);
        assert.equal(receipt.keychain, "written");
        assert.equal(receipt.credential?.provider, "openai");
        assert.equal(receipt.credential?.kind, "api_key");
        assert.equal(receipt.credential?.state, "active");
        assert.ok(!JSON.stringify(receipt).includes(FAKE_KEY));
        assert.equal(keychain.writes.length, 1);
    });

    test("the receipt names the command that selects it, because storing selects nothing", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });

        const receipt = await create(handlers, { provider: "openai" });

        assert.match(receipt.select, /^pico providers update openai --credential /);
        assert.ok(receipt.select.includes(receipt.credential?.reference ?? "none"));
        assert.equal(bindingsOf(dataDir), undefined);
    });

    test("a preview stores nothing, reads no Keychain item and keeps the index revision", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const before = await list(handlers);

        const receipt = await create(handlers, { provider: "openai", dryRun: true });

        assert.deepEqual(
            [receipt.dryRun, receipt.changed, receipt.stored, receipt.keychain, receipt.credential],
            [true, false, false, "not-checked", null],
        );
        assert.equal(receipt.revision, before.revision);
        assert.deepEqual([keychain.writes, keychain.reads], [[], []]);
        assert.deepEqual((await list(handlers)).items, []);
    });

    test("a provider that takes no pasted key is refused before the key is stored", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });

        const error = await rejection(
            handlers,
            "credentials create",
            input({ provider: "amazon-bedrock", stdin: true }),
        );

        assert.equal(error.code, "FAILED_PRECONDITION");
        assert.equal(error.details.provider, "amazon-bedrock");
        assert.deepEqual(keychain.writes, []);
    });

    test("a provider this engine does not declare is not found", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });

        const error = await rejection(
            handlers,
            "credentials create",
            input({ provider: "not-a-provider", stdin: true }),
        );

        assert.equal(error.code, "NOT_FOUND");
    });

    test("a stale --if-revision refuses the change and stores nothing", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        await create(handlers, { provider: "openai" });

        const error = await rejection(
            handlers,
            "credentials create",
            input({ provider: "openai", stdin: true, ifRevision: "none" }),
        );

        assert.equal(error.code, "CONFLICT");
        assert.equal(keychain.writes.length, 1);
    });

    test("a Keychain that will not take the item fails without publishing a credential", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        keychain.failNext("set", keychainFailure("KEYCHAIN_ACCESS_DENIED", "set", -25293));

        const error = await rejection(
            handlers,
            "credentials create",
            input({ provider: "openai", stdin: true }),
        );

        assert.equal(error.code, "KEYCHAIN_ACCESS_DENIED");
        assert.deepEqual((await list(handlers)).items, []);
    });
});

describe("proposal.0009 pico credentials list and get", () => {
    test("stored credentials are listed with their provider and kind, and no key", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });

        const listed = await list(handlers);

        assert.deepEqual(
            listed.items.map(item => [item.reference, item.provider, item.kind, item.state]),
            [[created.credential?.reference, "openai", "api_key", "active"]],
        );
        assert.ok(!JSON.stringify(listed).includes(FAKE_KEY));
    });

    test("--provider keeps one provider's credentials and an unknown one keeps none", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });
        await create(handlers, { provider: "openai" });

        assert.equal((await list(handlers, { provider: "openai" })).items.length, 1);
        assert.deepEqual((await list(handlers, { provider: "anthropic" })).items, []);
    });

    test("listing reads no Keychain item, so it never claims the credential works", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        await create(handlers, { provider: "openai" });
        keychain.reads.length = 0;

        await list(handlers);

        assert.deepEqual(keychain.reads, []);
    });

    test("get reads the item to establish it is there, and still prints no key", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;

        const found = await get(handlers, reference);

        assert.deepEqual([found.item.reference, found.keychain], [reference, "readable"]);
        assert.ok(keychain.reads.includes(reference));
        assert.ok(!JSON.stringify(found).includes(FAKE_KEY));
    });

    test("a reference Pico never issued is not found", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const error = await rejection(
            handlers,
            "credentials get",
            input({}, { reference: "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b" }),
        );

        assert.equal(error.code, "NOT_FOUND");
    });

    test("a Keychain item removed by hand is unavailable, never another account", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const first = await create(handlers, { provider: "openai" });
        const second = await create(handlers, { provider: "openai" });
        keychain.items.delete(first.credential?.reference as string);

        const error = await rejection(
            handlers,
            "credentials get",
            input({}, { reference: first.credential?.reference as string }),
        );

        // Pico still has the reference; what is gone is its payload, which is not "no such
        // credential" and must never resolve to the sibling stored for the same provider.
        assert.equal(error.code, "UNAVAILABLE");
        assert.ok(!error.message.includes(second.credential?.reference as string));
    });

    test("a locked Keychain is a different failure from a refused one", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;
        keychain.failNext("get", keychainFailure("KEYCHAIN_LOCKED", "get", -25291));

        const locked = await rejection(handlers, "credentials get", input({}, { reference }));
        assert.equal(locked.code, "KEYCHAIN_LOCKED");
        assert.equal(locked.retryable, true);

        keychain.failNext("get", keychainFailure("KEYCHAIN_UI_REQUIRED", "get", -25308));
        const needsUi = await rejection(handlers, "credentials get", input({}, { reference }));
        assert.equal(needsUi.code, "FAILED_PRECONDITION");
        assert.equal(needsUi.retryable, false);
        assert.match(needsUi.message, /--allow-keychain-ui/);
    });
});

describe("proposal.0009 pico credentials delete", () => {
    test("deleting removes the index row and its Keychain item", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;

        const receipt = await remove(handlers, reference);

        assert.deepEqual([receipt.changed, receipt.keychain], [true, "deleted"]);
        assert.deepEqual((await list(handlers)).items, []);
        assert.equal(keychain.items.has(reference), false);
    });

    test("a reference Pico does not have is an unchanged receipt, so deleting is retryable", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const receipt = await remove(handlers, "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b");

        assert.deepEqual(
            [receipt.changed, receipt.credential, receipt.keychain],
            [false, null, "not-checked"],
        );
    });

    test("a preview removes nothing and touches no Keychain item", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;
        keychain.deletes.length = 0;

        const receipt = await remove(handlers, reference, { dryRun: true });

        assert.deepEqual(
            [receipt.dryRun, receipt.changed, receipt.keychain],
            [true, true, "not-checked"],
        );
        assert.equal(receipt.credential?.reference, reference);
        assert.deepEqual(keychain.deletes, []);
        assert.equal((await list(handlers)).items.length, 1);
    });

    test("a credential a provider still selects is refused, naming that provider", async (t: Cleanups) => {
        const { handlers, dataDir, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;
        bind(dataDir, { openai: reference });

        const error = await rejection(handlers, "credentials delete", input({}, { reference }));

        assert.equal(error.code, "FAILED_PRECONDITION");
        assert.equal(error.details.provider, "openai");
        assert.deepEqual(keychain.deletes, []);
        assert.equal((await list(handlers)).items.length, 1);
    });

    test("a stale --if-revision refuses the deletion", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });

        const error = await rejection(
            handlers,
            "credentials delete",
            input({ ifRevision: "none" }, { reference: created.credential?.reference as string }),
        );

        assert.equal(error.code, "CONFLICT");
        assert.equal((await list(handlers)).items.length, 1);
    });

    test("a Keychain deletion Pico may not make keeps the credential recorded for a retry", async (t: Cleanups) => {
        const { handlers, keychain, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;
        keychain.failNext("delete", keychainFailure("KEYCHAIN_ACCESS_DENIED", "delete", -25293));

        const error = await rejection(handlers, "credentials delete", input({}, { reference }));

        assert.equal(error.code, "KEYCHAIN_ACCESS_DENIED");
        assert.ok(error.message.includes(reference));
        const remembered = testVault(t, dataDir, keychain).metadata(reference);
        assert.equal(remembered?.state, "deleting");

        const retried = await remove(handlers, reference);
        assert.equal(retried.changed, true);
        assert.deepEqual((await list(handlers)).items, []);
    });
});

describe("proposal.0009 credential mutations that happen at the same time", () => {
    test("two keys stored at once both land, under references of their own", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });

        const [first, second] = await Promise.all([
            create(handlers, { provider: "openai" }),
            create(handlers, { provider: "openai" }),
        ]);

        assert.notEqual(first.credential?.reference, second.credential?.reference);
        assert.equal((await list(handlers)).items.length, 2);
        assert.notEqual(first.revision, second.revision);
    });

    test("only one of two writers guarding the same revision wins", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });
        const revision = (await list(handlers)).revision;

        const settled = await Promise.allSettled([
            create(handlers, { provider: "openai", ifRevision: revision }),
            create(handlers, { provider: "openai", ifRevision: revision }),
        ]);

        const stored = settled.filter(result => result.status === "fulfilled");
        const refused = settled.filter(result => result.status === "rejected");
        assert.equal(stored.length, 1);
        assert.equal(refused.length, 1);
        assert.equal((refused[0] as PromiseRejectedResult).reason.code, "CONFLICT");
        assert.equal((await list(handlers)).items.length, 1);
    });

    test("deleting a credential while it is being selected leaves no dangling reference", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const created = await create(handlers, { provider: "openai" });
        const reference = created.credential?.reference as string;

        const settled = await Promise.allSettled([
            handlers["providers update"](input({ credential: reference }, { provider: "openai" })),
            remove(handlers, reference),
        ]);

        const bindings = bindingsOf(dataDir) ?? {};
        const stored = (await list(handlers)).items.map(item => item.reference);
        // Whichever order the lock granted, a saved selection names a credential that is there.
        for (const [provider, selected] of Object.entries(bindings)) {
            assert.ok(stored.includes(selected), `${provider} selects a credential that is gone`);
        }
        assert.equal(settled.length, 2);
    });
});

function bindingsOf(dataDir: string): Record<string, string> | undefined {
    const state = readSettings(dataDir);
    return state.status === "valid" ? state.item.providerCredentials : undefined;
}
