import { afterEach, describe, expect, test } from "bun:test";

import type { PicoSession } from "../engine/pico-session.ts";

import {
    connectPicoAgent,
    METHOD_NOT_FOUND,
    requestError,
    type ConnectedClient,
} from "./agent-harness.ts";

const VERSION = "4.2.0";

let connected: ConnectedClient | undefined;

function connect(): ConnectedClient {
    connected = connectPicoAgent({
        version: VERSION,
        createSession: (): Promise<PicoSession> => {
            throw new Error("initialize must not create a session");
        },
    });
    return connected;
}

afterEach(async () => {
    await connected?.close();
    connected = undefined;
});

describe("proposal.0001 initialize", () => {
    test("answers protocol version 1 for a client that asks for version 1", async () => {
        expect((await connect().initialize(1)).protocolVersion).toBe(1);
    });

    test("answers protocol version 1 for a client that asks for a later version", async () => {
        expect((await connect().initialize(2)).protocolVersion).toBe(1);
    });

    test("claims only the capabilities Pico implements", async () => {
        const response = await connect().initialize();

        expect(response.agentCapabilities).toEqual({
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            mcpCapabilities: { http: false, sse: false },
        });
    });

    test("identifies itself as Pico with the package version", async () => {
        const response = await connect().initialize();

        expect(response.agentInfo).toEqual({ name: "pico", title: "Pico", version: VERSION });
    });

    test("offers no authentication methods", async () => {
        expect((await connect().initialize()).authMethods).toEqual([]);
    });

    test("sends no vendor metadata", async () => {
        const response = await connect().initialize();

        expect(Object.keys(response).toSorted()).toEqual([
            "agentCapabilities",
            "agentInfo",
            "authMethods",
            "protocolVersion",
        ]);
    });
});

describe("proposal.0001 unsupported methods", () => {
    test.each([
        ["session/load", { sessionId: "s", cwd: "/tmp", mcpServers: [] }],
        ["session/list", {}],
        ["session/resume", { sessionId: "s", cwd: "/tmp", mcpServers: [] }],
        ["session/close", { sessionId: "s" }],
        ["session/set_mode", { sessionId: "s", modeId: "default" }],
        ["session/set_config_option", { sessionId: "s", configOptionId: "model", value: "x" }],
        ["authenticate", { methodId: "oauth" }],
    ])("%s is answered with method not found", async (method, params) => {
        const session = connect();
        await session.initialize();

        const error = await requestError(session.agent.request(method, params));

        expect(error.code).toBe(METHOD_NOT_FOUND);
        expect(error.message).toContain(method);
    });
});
