import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import { exited, fakeMcpServer } from "./testing/mcp-fixture.ts";
import {
    boundCredential,
    createMockModel,
    mockAuthStorage,
    picoCredentials,
    picoWorkspace,
    unauthenticatedAuthStorage,
    useAsProcessAgentDir,
    withoutProviderCredentials,
} from "./testing/session-fixture.ts";

/** The provider the mock model answers for; a session must have a credential bound to it. */
const MOCK_PROVIDER = "mock";

describe("proposal.0009 Pico's own credentials", () => {
    test("a session resolves the credential its settings bind to the model's provider", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const { keychain, reference } = await boundCredential(dataDir, MOCK_PROVIDER, "bound-key");

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        const resolved = await session.engine.modelRegistry.getApiKeyForProvider(MOCK_PROVIDER);
        assert.equal(resolved, "bound-key", `the session did not use ${reference}`);
    });

    test("the credentials Pico opened are closed when the session is disposed", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const { keychain } = await boundCredential(dataDir, MOCK_PROVIDER);
        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        const store = session.engine.modelRegistry.authStorage;

        await session.dispose();

        await assert.rejects(store.credentials.reload(), "Pico left its own credential store open");
    });

    test("credentials the caller injected outlive the session", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const authStorage = await mockAuthStorage(dataDir);
        const session = await createPicoSession({
            cwd,
            dataDir,
            mcpServers: [],
            authStorage,
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });

        await session.dispose();

        await authStorage.credentials.reload();
    });

    test("a settings file Pico cannot use fails creation instead of resolving a last binding", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const { keychain } = await boundCredential(dataDir, MOCK_PROVIDER);
        fs.writeFileSync(settingsFilePath(dataDir), '{"version":2,"providerCredentials":{"a":7}}');

        await assert.rejects(
            createPicoSession({
                cwd,
                dataDir,
                keychain,
                mcpServers: [],
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.ok(
                    error.message.includes(settingsFilePath(dataDir)),
                    `the message does not name the settings file: ${error.message}`,
                );
                return true;
            },
        );
    });

    test("disconnecting the provider stops the next session from resolving its credential", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const { keychain } = await boundCredential(dataDir, MOCK_PROVIDER);
        writeSettings(dataDir, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: {},
        });

        await assert.rejects(
            createPicoSession({
                cwd,
                dataDir,
                keychain,
                mcpServers: [],
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /credential/i);
                return true;
            },
        );
    });
});

describe("proposal.0009 the user's Oh My Pi store", () => {
    test("a session neither reads nor writes the credential store in the user's agent directory", async t => {
        withoutProviderCredentials(t);
        const workspace = picoWorkspace(t);
        const { cwd, agentDir, dataDir } = workspace;
        // The directory the process would resolve as the user's `~/.omp/agent`.
        useAsProcessAgentDir(t, agentDir);
        const store = path.join(agentDir, "agent.db");
        fs.writeFileSync(store, "not Pico's to open\n");
        const before = {
            listing: fs.readdirSync(agentDir).toSorted(),
            bytes: fs.readFileSync(store),
        };
        const { keychain } = await boundCredential(dataDir, MOCK_PROVIDER);

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        await session.engine.prompt("hello");
        await session.dispose();

        assert.deepEqual(fs.readdirSync(agentDir).toSorted(), before.listing);
        assert.ok(
            fs.readFileSync(store).equals(before.bytes),
            "Pico opened the user's credential store",
        );
    });
});

describe("proposal.0001 model selection", () => {
    test("a configuration that resolves no model fails creation instead of substituting one", async t => {
        withoutProviderCredentials(t);
        const { cwd, dataDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({ cwd, dataDir, mcpServers: [] }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /no model/i);
                assert.ok(
                    error.message.includes(cwd),
                    `the message does not say which project has no model: ${error.message}`,
                );
                return true;
            },
        );
    });

    test("the failure for a session with no credentials names Pico's own commands", async t => {
        withoutProviderCredentials(t);
        const { cwd, dataDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({ cwd, dataDir, mcpServers: [] }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /pico auth login|pico credentials create/);
                assert.doesNotMatch(error.message, /Sign in .*Oh My Pi/);
                return true;
            },
        );
    });

    test("a model whose credentials cannot be resolved fails creation", async t => {
        const { cwd, dataDir } = picoWorkspace(t);

        await assert.rejects(
            createPicoSession({
                cwd,
                dataDir,
                mcpServers: [],
                authStorage: await unauthenticatedAuthStorage(dataDir),
                model: createMockModel({ responses: [{ content: ["ok"] }] }),
            }),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /credential/i);
                assert.match(error.message, /mock/);
                return true;
            },
        );
    });

    test("a failure after the engine exists still terminates the MCP servers", async t => {
        withoutProviderCredentials(t);
        const { cwd, dataDir } = picoWorkspace(t);
        const pidFile = path.join(cwd, "fake.pid");

        await assert.rejects(
            createPicoSession({
                cwd,
                dataDir,
                mcpServers: [fakeMcpServer("fake", { flags: ["--pid-file", pidFile] })],
            }),
            PicoSessionError,
        );

        assert.ok(
            fs.existsSync(pidFile),
            "the MCP server never started, so nothing was left to terminate",
        );
        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        assert.ok(await exited(pid), `the MCP server (pid ${pid}) outlived the failed session`);
    });
});

describe("proposal.0009 stored credentials stay Pico's", () => {
    test("a session stores no credential payload in Pico's data directory", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const { keychain } = await boundCredential(dataDir, MOCK_PROVIDER, "payload-marker");
        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        await session.engine.prompt("hello");
        await session.dispose();

        for (const entry of walk(dataDir)) {
            assert.ok(
                !fs.readFileSync(entry).toString("binary").includes("payload-marker"),
                `${entry} holds the credential's secret`,
            );
        }
    });

    test("one stored credential does not let a second provider resolve one", async t => {
        const { cwd, dataDir } = picoWorkspace(t);
        const credentials = await picoCredentials(dataDir);
        t.after(() => credentials.close());
        credentials.bind(MOCK_PROVIDER, "mock-key");
        credentials.vault.create("other-provider", { type: "api_key", key: "other-key" });

        const session = await createPicoSession({
            cwd,
            dataDir,
            keychain: credentials.keychain,
            mcpServers: [],
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        const resolved = await session.engine.modelRegistry.getApiKeyForProvider("other-provider");
        assert.equal(resolved, undefined, "an unselected credential authorized its provider");
    });
});

function* walk(directory: string): Generator<string> {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}
