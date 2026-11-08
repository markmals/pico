import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { serializeSettings } from "../settings/settings-document.ts";
import { readSettings, settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { createPicoSession } from "./pico-session.ts";
import {
    createMockModel,
    picoCredentials,
    picoWorkspace,
    toolCall,
} from "./testing/session-fixture.ts";

/** The provider the mock model answers for. */
const MOCK_PROVIDER = "mock";

function bind(dataDir: string, reference: string): void {
    const state = readSettings(dataDir);
    const item = "item" in state ? state.item : undefined;
    writeSettings(dataDir, {
        defaultModel: item?.defaultModel ?? null,
        defaultThinking: item?.defaultThinking ?? null,
        autoBackground: item?.autoBackground ?? null,
        intellisensePath: item?.intellisensePath ?? null,
        providerCredentials: { [MOCK_PROVIDER]: reference },
    });
}

describe("proposal.0009 a session's provider requests", () => {
    test("a later request in the same turn resolves the binding saved during that turn", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const credentials = await picoCredentials(dataDir);
        t.after(() => credentials.close());
        credentials.bind(MOCK_PROVIDER, "first-key");
        const second = credentials.vault.create(MOCK_PROVIDER, {
            type: "api_key",
            key: "second-key",
        }).reference;

        const state = readSettings(dataDir);
        assert.ok("item" in state);
        const model = createMockModel({
            responses: [
                {
                    content: [
                        toolCall("write", {
                            path: settingsFilePath(dataDir),
                            content: serializeSettings({
                                ...state.item,
                                providerCredentials: { [MOCK_PROVIDER]: second },
                            }),
                        }),
                    ],
                },
                { content: ["done"] },
            ],
        });

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain: credentials.keychain,
            mcpServers: [],
            model,
        });
        t.after(() => session.dispose());

        await session.engine.prompt("run something, then answer");

        assert.deepEqual(
            model.calls.map(call => call.options?.apiKey),
            ["first-key", "second-key"],
        );
    });

    test("disconnecting an open session raises Pico authentication-required before dispatch", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const credentials = await picoCredentials(dataDir);
        t.after(() => credentials.close());
        credentials.bind(MOCK_PROVIDER, "first-key");
        const model = createMockModel({
            responses: [{ content: ["connected"] }, { content: ["must not dispatch"] }],
        });
        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain: credentials.keychain,
            mcpServers: [],
            model,
        });
        t.after(() => session.dispose());
        await session.engine.prompt("connected control");
        const state = readSettings(dataDir);
        assert.ok("item" in state);
        writeSettings(dataDir, { ...state.item, providerCredentials: {} });

        await assert.rejects(session.engine.prompt("must fail without a binding"), {
            code: "AUTH_REQUIRED",
        });

        assert.deepEqual(
            model.calls.map(call => call.options?.apiKey),
            ["first-key"],
        );
        assert.equal(session.engine.model?.id, model.id);
    });

    test("changing the binding changes no session's model or thinking level", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const credentials = await picoCredentials(dataDir);
        t.after(() => credentials.close());
        credentials.bind(MOCK_PROVIDER, "first-key");
        const replacement = credentials.vault.create(MOCK_PROVIDER, {
            type: "api_key",
            key: "second-key",
        }).reference;

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain: credentials.keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());
        const model = session.engine.model?.id;
        const thinking = session.engine.thinkingLevel;

        bind(dataDir, replacement);
        await session.engine.prompt("hello");

        assert.equal(session.engine.model?.id, model, "the binding change switched the model");
        assert.equal(
            session.engine.thinkingLevel,
            thinking,
            "the binding change switched the thinking level",
        );
        assert.equal(
            await session.engine.modelRegistry.getApiKeyForProvider(MOCK_PROVIDER),
            "second-key",
        );
    });
});
