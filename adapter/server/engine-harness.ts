import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { MockModel, MockResponseSource } from "@oh-my-pi/pi-ai/providers/mock";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent";

import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PicoSession } from "../engine/pico-session.ts";

import { createPicoSession } from "../engine/pico-session.ts";

registerMockApi();

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
}

/** A project directory for one session; removed by {@link removeTemporaryDirectories}. */
export function temporaryProject(): string {
    return temporaryDirectory("pico-project-");
}

export function removeTemporaryDirectories(): void {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
}

/** A stand-in for `~/Library/Application Support/Pico`; removed by {@link removeTemporaryDirectories}. */
export function temporaryDataDir(): string {
    return temporaryDirectory("pico-data-dir-");
}

interface Credentials {
    readonly agentDir: string;
    readonly dataDir: string;
    readonly authStorage: AuthStorage;
}

let sharedCredentials: Promise<Credentials> | undefined;

/** One credential store for the whole process: opening it costs more than a session does. */
function credentials(): Promise<Credentials> {
    sharedCredentials ??= (async () => {
        const agentDir = temporaryDirectory("pico-agent-dir-");
        const authStorage = await discoverAuthStorage(agentDir);
        authStorage.keys.setRuntime("mock", "test");
        return { agentDir, dataDir: temporaryDataDir(), authStorage };
    })();
    return sharedCredentials;
}

/** A Pico session factory backed by the real engine and a scripted model. */
export interface MockEngine {
    readonly model: MockModel;
    createSession(cwd: string, mcpServers: McpServerStdio[]): Promise<PicoSession>;
}

export async function mockEngine(responses: MockResponseSource): Promise<MockEngine> {
    const { agentDir, dataDir, authStorage } = await credentials();
    const model = createMockModel({ responses });
    return {
        model,
        createSession: (cwd, mcpServers) =>
            createPicoSession({ cwd, mcpServers, agentDir, dataDir, authStorage, model }),
    };
}
