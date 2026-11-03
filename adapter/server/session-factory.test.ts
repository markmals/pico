import type { NewSessionResponse, SessionConfigOption } from "@agentclientprotocol/sdk";

import { discoverAuthStorage, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { cfgBashAutoBackgroundEnabled } from "@oh-my-pi/pi-coding-agent/exec/settings";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";
import type { ConnectedClient } from "./agent-harness.ts";

import { createPicoModelRegistry } from "../engine/model-catalog.ts";
import { testProvider } from "../engine/testing/test-provider.ts";
import { settingsFilePath, writeSettings } from "../settings/settings-store.ts";
import { connectPicoAgent } from "./agent-harness.ts";
import {
    removeTemporaryDirectories,
    temporaryDataDir,
    temporaryProject,
} from "./engine-harness.ts";
import { picoSessionFactory } from "./session-factory.ts";

const open: ConnectedClient[] = [];

afterEach(async () => {
    for (const client of open.splice(0)) await client.close();
});

afterAll(removeTemporaryDirectories);

async function connect(dataDir: string) {
    const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pico-agent-dir-")));
    const authStorage = await discoverAuthStorage(agentDir);
    const modelRegistry = createPicoModelRegistry(authStorage, dataDir);
    testProvider().register(modelRegistry);
    const client = connectPicoAgent({
        version: "0.0.0-test",
        dataDir,
        createSession: picoSessionFactory({ dataDir, agentDir, authStorage, modelRegistry }),
    });
    open.push(client);
    await client.initialize();
    return client;
}

function currentModel(options: SessionConfigOption[] | null | undefined): unknown {
    return options?.find(option => option.id === "model")?.currentValue;
}

describe("proposal.0007 sessions start from the settings file", () => {
    test("each new session starts on the default saved at that moment", async () => {
        const dataDir = temporaryDataDir();
        const client = await connect(dataDir);
        const cwd = temporaryProject();

        writeSettings(dataDir, {
            defaultModel: "pico-test/alpha",
            defaultThinking: "off",
            autoBackground: null,
        });
        const first = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        writeSettings(dataDir, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
            autoBackground: null,
        });
        const second = (await client.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;

        expect(currentModel(first.configOptions)).toBe("pico-test/alpha");
        expect(currentModel(second.configOptions)).toBe("pico-test/beta");
    });

    test("an invalid file fails a new session, and a session reopens on its own model", async () => {
        const dataDir = temporaryDataDir();
        const cwd = temporaryProject();
        const first = await connect(dataDir);
        writeSettings(dataDir, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
            autoBackground: null,
        });
        const created = (await first.agent.request("session/new", {
            cwd,
            mcpServers: [],
        })) as NewSessionResponse;
        await first.close();

        writeFileSync(settingsFilePath(dataDir), "not json");
        const second = await connect(dataDir);

        await expect(second.agent.request("session/new", { cwd, mcpServers: [] })).rejects.toThrow(
            settingsFilePath(dataDir),
        );
        const reopened = (await second.agent.request("session/resume", {
            sessionId: created.sessionId,
            cwd,
            mcpServers: [],
        })) as { configOptions?: SessionConfigOption[] | null };
        expect(currentModel(reopened.configOptions)).toBe("pico-test/beta");
    });
});

describe("proposal.0008 every attach reads the auto-background setting", () => {
    test("new and reopened sessions attach with the value saved at that moment", async () => {
        const dataDir = temporaryDataDir();
        const cwd = temporaryProject();
        const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pico-agent-dir-")));
        const authStorage = await discoverAuthStorage(agentDir);
        const modelRegistry = createPicoModelRegistry(authStorage, dataDir);
        testProvider().register(modelRegistry);
        const create = picoSessionFactory({ dataDir, agentDir, authStorage, modelRegistry });
        const autoBackground = (session: PicoSession) =>
            cfgBashAutoBackgroundEnabled.get(session.engine.settings);

        writeFileSync(settingsFilePath(dataDir), '{ "version": 1, "autoBackground": false }\n');
        const fresh = await create(cwd, [], SessionManager.inMemory(cwd), true);
        writeFileSync(settingsFilePath(dataDir), '{ "version": 1, "autoBackground": true }\n');
        const reopened = await create(cwd, [], SessionManager.inMemory(cwd), false);
        try {
            expect(autoBackground(fresh)).toBe(false);
            expect(autoBackground(reopened)).toBe(true);
        } finally {
            await fresh.dispose();
            await reopened.dispose();
        }
    });
});
