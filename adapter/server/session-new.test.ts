import type { McpServer, NewSessionResponse } from "@agentclientprotocol/sdk";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ConnectedClient } from "./agent-harness.ts";
import type { PicoSessionFactory } from "./pico-agent.ts";

import { PicoSessionError } from "../engine/pico-session.ts";
import { assistantText, connectPicoAgent, INVALID_PARAMS, requestError } from "./agent-harness.ts";
import { mockEngine, removeTemporaryDirectories, temporaryProject } from "./engine-harness.ts";

let connected: ConnectedClient | undefined;

async function connect(createSession: PicoSessionFactory): Promise<ConnectedClient> {
    connected = connectPicoAgent({ version: "0.0.0-test", createSession });
    await connected.initialize();
    return connected;
}

function newSession(client: ConnectedClient, cwd: string, mcpServers: McpServer[] = []) {
    return client.agent.request("session/new", { cwd, mcpServers });
}

afterEach(async () => {
    await connected?.close();
    connected = undefined;
});

afterAll(() => {
    removeTemporaryDirectories();
});

describe("proposal.0001 session/new rejects a working directory it cannot use", () => {
    let factoryCalls = 0;
    const neverCalled: PicoSessionFactory = () => {
        factoryCalls++;
        throw new Error("no session may be created for an invalid request");
    };

    test("a relative cwd fails with invalid params naming the path", async () => {
        const client = await connect(neverCalled);

        const error = await requestError(newSession(client, "relative/project"));

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain("relative/project");
        expect(error.message).toContain("absolute");
        expect(factoryCalls).toBe(0);
    });

    test("a cwd that does not exist fails with invalid params naming the path", async () => {
        const client = await connect(neverCalled);
        const missing = join(temporaryProject(), "no-such-directory");

        const error = await requestError(newSession(client, missing));

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain(missing);
        expect(factoryCalls).toBe(0);
    });
});

describe("proposal.0001 session/new accepts stdio MCP servers only", () => {
    const neverCalled: PicoSessionFactory = () => {
        throw new Error("no session may be created for an invalid request");
    };

    test("an HTTP MCP server fails with invalid params naming the server", async () => {
        const client = await connect(neverCalled);

        const error = await requestError(
            newSession(client, temporaryProject(), [
                { type: "http", name: "sesh-http", url: "https://example.test/mcp", headers: [] },
            ]),
        );

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain("sesh-http");
        expect(error.message).toContain("stdio");
    });

    test("an SSE MCP server fails with invalid params naming the server", async () => {
        const client = await connect(neverCalled);

        const error = await requestError(
            newSession(client, temporaryProject(), [
                { type: "sse", name: "sesh-sse", url: "https://example.test/sse", headers: [] },
            ]),
        );

        expect(error.code).toBe(INVALID_PARAMS);
        expect(error.message).toContain("sesh-sse");
        expect(error.message).toContain("stdio");
    });
});

describe("proposal.0001 session/new reports why a session could not be created", () => {
    test("a session creation failure reaches the client with its message", async () => {
        const client = await connect(() =>
            Promise.reject(new PicoSessionError("No model is configured for this project")),
        );

        const error = await requestError(newSession(client, temporaryProject()));

        expect(error.message).toContain("No model is configured for this project");
    });
});

describe("proposal.0001 session/new creates independent sessions", () => {
    test("the response carries a session id and nothing else", async () => {
        const engine = await mockEngine([{ content: ["ok"] }]);
        const client = await connect(engine.createSession);

        const response = (await newSession(client, temporaryProject())) as NewSessionResponse;

        expect(Object.keys(response)).toEqual(["sessionId"]);
        expect(typeof response.sessionId).toBe("string");
    });

    test("session ids stay unique across connections in the process", async () => {
        const engine = await mockEngine([{ content: ["ok"] }]);
        const other = connectPicoAgent({
            version: "0.0.0-test",
            createSession: engine.createSession,
        });
        await other.initialize();
        const first = (await newSession(other, temporaryProject())) as NewSessionResponse;
        await other.close();

        const client = await connect(engine.createSession);
        const second = (await newSession(client, temporaryProject())) as NewSessionResponse;

        expect(second.sessionId).not.toBe(first.sessionId);
    });

    test("each session on a connection gets its own id and its own updates", async () => {
        const engine = await mockEngine([
            { content: ["first answer"] },
            { content: ["second answer"] },
        ]);
        const client = await connect(engine.createSession);

        const first = (await newSession(client, temporaryProject())) as NewSessionResponse;
        const second = (await newSession(client, temporaryProject())) as NewSessionResponse;
        expect(first.sessionId).not.toBe(second.sessionId);

        await client.agent.request("session/prompt", {
            sessionId: first.sessionId,
            prompt: [{ type: "text", text: "one" }],
        });
        await client.agent.request("session/prompt", {
            sessionId: second.sessionId,
            prompt: [{ type: "text", text: "two" }],
        });

        expect(assistantText(client.updatesFor(first.sessionId))).toBe("first answer");
        expect(assistantText(client.updatesFor(second.sessionId))).toBe("second answer");
    });
});
