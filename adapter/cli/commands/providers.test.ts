import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import type { Cleanups } from "../../engine/testing/session-fixture.ts";
import type { CommandHandlers as Handlers } from "./handlers.ts";

import { keychainFailure } from "../../credentials/testing/memory-secret-store.ts";
import { readSettings, settingsFilePath, writeSettings } from "../../settings/settings-store.ts";
import {
    credentialsCreateOutput,
    providersGetOutput,
    providersListOutput,
    providersUpdateOutput,
} from "../result-schemas.ts";
import { input, rejection, testHandlers } from "./testing.ts";

const FAKE_KEY = "FAKE-pico-0009-not-a-provider-credential";

async function list(handlers: Handlers) {
    return providersListOutput.parse({
        apiVersion: 1,
        ...(await handlers["providers list"](input())),
    });
}

async function get(handlers: Handlers, provider: string) {
    return providersGetOutput.parse({
        apiVersion: 1,
        ...(await handlers["providers get"](input({}, { provider }))),
    });
}

async function update(
    handlers: Handlers,
    provider: string,
    options: Record<string, string | boolean>,
) {
    return providersUpdateOutput.parse({
        apiVersion: 1,
        ...(await handlers["providers update"](input(options, { provider }))),
    });
}

async function storeKey(handlers: Handlers, provider: string): Promise<string> {
    const receipt = credentialsCreateOutput.parse({
        apiVersion: 1,
        ...(await handlers["credentials create"](input({ provider, stdin: true }))),
    });
    return receipt.credential?.reference as string;
}

describe("proposal.0009 pico providers list and get", () => {
    test("a provider reports how it is connected and what is selected", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t, { stdin: FAKE_KEY });

        const openai = (await list(handlers)).items.find(item => item.provider === "openai");

        assert.equal(openai?.apiKey, true);
        assert.equal(openai?.apiKeyUnsupported, null);
        assert.equal(openai?.credential, null);
    });

    test("a provider that takes no pasted key says so instead of offering one", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const bedrock = await get(handlers, "amazon-bedrock");

        assert.equal(bedrock.item.apiKey, false);
        assert.ok((bedrock.item.apiKeyUnsupported ?? "").length > 0);
    });

    test("a login method names the provider its result is stored under", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const codex = await get(handlers, "openai-codex");
        const device = codex.item.methods.find(method => method.method === "openai-codex-device");

        assert.equal(device?.provider, "openai-codex");
        assert.equal(device?.supported, true);
    });

    test("an unsupported method is listed with its reason rather than hidden", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const copilot = await get(handlers, "github-copilot");
        const method = copilot.item.methods.find(entry => entry.method === "github-copilot");

        assert.equal(method?.supported, false);
        assert.match(method?.unsupported ?? "", /Enterprise/);
    });

    test("an id this engine does not declare is not found", async (t: Cleanups) => {
        const { handlers } = await testHandlers(t);

        const error = await rejection(
            handlers,
            "providers get",
            input({}, { provider: "not-a-provider" }),
        );

        assert.equal(error.code, "NOT_FOUND");
    });

    test("a selected credential is reported as metadata, never as a key", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        await update(handlers, "openai", { credential: reference });

        const openai = await get(handlers, "openai");

        assert.equal(openai.item.credential?.reference, reference);
        assert.equal(openai.item.credential?.kind, "api_key");
        assert.ok(!JSON.stringify(openai).includes(FAKE_KEY));
        assert.deepEqual(readSettingsBindings(dataDir), { openai: reference });
    });

    test("listing reads no Keychain item", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        await storeKey(handlers, "openai");
        keychain.reads.length = 0;

        await list(handlers);

        assert.deepEqual(keychain.reads, []);
    });
});

describe("proposal.0009 pico providers update", () => {
    test("selecting a credential saves the binding and reports before and after", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");

        const receipt = await update(handlers, "openai", { credential: reference });

        assert.deepEqual(
            [receipt.changed, receipt.dryRun, receipt.before.credential, receipt.after.credential],
            [true, false, null, reference],
        );
        assert.equal(receipt.keychain, "readable");
        assert.notEqual(receipt.after.revision, receipt.before.revision);
        assert.deepEqual(readSettingsBindings(dataDir), { openai: reference });
    });

    test("selecting changes no model default", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        writeSettings(dataDir, {
            defaultModel: "pico-test/alpha",
            defaultThinking: "off",
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: {},
        });
        const reference = await storeKey(handlers, "openai");

        await update(handlers, "openai", { credential: reference });

        const state = readSettings(dataDir);
        assert.equal(state.status === "valid" && state.item.defaultModel, "pico-test/alpha");
        assert.equal(state.status === "valid" && state.item.defaultThinking, "off");
    });

    test("repeating the selection changes nothing and writes nothing", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        const first = await update(handlers, "openai", { credential: reference });
        const bytes = fileBytes(dataDir);

        const again = await update(handlers, "openai", { credential: reference });

        assert.equal(again.changed, false);
        assert.equal(again.after.revision, first.after.revision);
        assert.equal(fileBytes(dataDir), bytes);
    });

    test("disconnecting an unbound provider is unchanged and creates no settings file", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t);

        const receipt = await update(handlers, "openai", { disconnect: true });

        assert.deepEqual([receipt.changed, receipt.after.credential], [false, null]);
        assert.equal(receipt.before.revision, "none");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("disconnecting keeps the credential stored and revokes nothing", async (t: Cleanups) => {
        const { handlers, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        await update(handlers, "openai", { credential: reference });
        keychain.deletes.length = 0;

        const receipt = await update(handlers, "openai", { disconnect: true });

        assert.deepEqual([receipt.changed, receipt.after.credential], [true, null]);
        assert.deepEqual(keychain.deletes, []);
        assert.equal(keychain.items.has(reference), true);
    });

    test("a preview checks the reference but no Keychain item, and writes nothing", async (t: Cleanups) => {
        const { handlers, dataDir, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        keychain.reads.length = 0;

        const receipt = await update(handlers, "openai", { credential: reference, dryRun: true });

        assert.deepEqual(
            [receipt.dryRun, receipt.changed, receipt.keychain],
            [true, true, "not-checked"],
        );
        assert.equal(receipt.after.credential, reference);
        assert.deepEqual(keychain.reads, []);
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a credential belonging to another provider is refused", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");

        const error = await rejection(
            handlers,
            "providers update",
            input({ credential: reference }, { provider: "anthropic" }),
        );

        assert.equal(error.code, "FAILED_PRECONDITION");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a reference Pico does not have is not found, and selects nothing", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t);

        const error = await rejection(
            handlers,
            "providers update",
            input({ credential: "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b" }, { provider: "openai" }),
        );

        assert.equal(error.code, "NOT_FOUND");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a credential whose Keychain item cannot be read is not selected", async (t: Cleanups) => {
        const { handlers, dataDir, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        keychain.failNext("get", keychainFailure("KEYCHAIN_ACCESS_DENIED", "get", -25293));

        const error = await rejection(
            handlers,
            "providers update",
            input({ credential: reference }, { provider: "openai" }),
        );

        assert.equal(error.code, "KEYCHAIN_ACCESS_DENIED");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a stale --if-revision refuses the change and leaves the file byte for byte", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        await update(handlers, "openai", { credential: reference });
        const bytes = fileBytes(dataDir);

        const error = await rejection(
            handlers,
            "providers update",
            input({ disconnect: true, ifRevision: "none" }, { provider: "openai" }),
        );

        assert.equal(error.code, "CONFLICT");
        assert.equal(fileBytes(dataDir), bytes);
    });

    test("a save delayed in Keychain never erases a newer settings change", async (t: Cleanups) => {
        const { handlers, dataDir, keychain } = await testHandlers(t, { stdin: FAKE_KEY });
        const reference = await storeKey(handlers, "openai");
        const getPayload = keychain.get.bind(keychain);
        let newerBytes: string | undefined;
        keychain.get = target => {
            if (newerBytes === undefined) {
                writeSettings(dataDir, {
                    defaultModel: "pico-test/newer",
                    defaultThinking: "off",
                    autoBackground: true,
                    intellisensePath: null,
                    providerCredentials: {},
                });
                newerBytes = fileBytes(dataDir);
            }
            return getPayload(target);
        };

        const error = await rejection(
            handlers,
            "providers update",
            input({ credential: reference }, { provider: "openai" }),
        );

        assert.equal(error.code, "CONFLICT");
        assert.equal(fileBytes(dataDir), newerBytes);
    });

    for (const dryRun of [false, true]) {
        test(`an unchanged ${dryRun ? "preview" : "save"} still refuses a stale revision`, async (t: Cleanups) => {
            const { handlers, dataDir } = await testHandlers(t, { stdin: FAKE_KEY });
            const reference = await storeKey(handlers, "openai");
            await update(handlers, "openai", { credential: reference });
            const bytes = fileBytes(dataDir);

            const error = await rejection(
                handlers,
                "providers update",
                input(
                    { credential: reference, ifRevision: "none", dryRun },
                    { provider: "openai" },
                ),
            );

            assert.equal(error.code, "CONFLICT");
            assert.equal(fileBytes(dataDir), bytes);
        });
    }

    test("an unusable settings file refuses the change rather than rewriting it", async (t: Cleanups) => {
        const { handlers, dataDir } = await testHandlers(t);
        const file = settingsFilePath(dataDir);
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(file, '{"version":99}');

        const error = await rejection(
            handlers,
            "providers update",
            input({ disconnect: true }, { provider: "openai" }),
        );

        assert.equal(error.code, "FAILED_PRECONDITION");
        assert.equal(fs.readFileSync(file, "utf8"), '{"version":99}');
    });
});

function fileBytes(dataDir: string): string | undefined {
    const file = settingsFilePath(dataDir);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function readSettingsBindings(dataDir: string): Record<string, string> | undefined {
    const state = readSettings(dataDir);
    return state.status === "valid" ? state.item.providerCredentials : undefined;
}
