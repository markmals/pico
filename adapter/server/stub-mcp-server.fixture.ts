/**
 * A minimal stdio MCP server, spawned by the server tests so they can watch Pico
 * mount its tools, call them, and terminate the child it started.
 *
 * It offers Sesh's two simplest tools, answers a call by echoing its arguments,
 * and serves nothing else.
 *
 * Usage: bun stub-mcp-server.fixture.ts <pid-file>
 */

export {};

interface JsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: {
        protocolVersion?: string;
        name?: string;
        arguments?: Record<string, unknown>;
    };
}

const TOOLS = [
    {
        name: "ask_user",
        description: "Asks the user a question and waits for the answer.",
        inputSchema: {
            type: "object",
            properties: { question: { type: "string" } },
            required: ["question"],
        },
    },
    {
        name: "notify",
        description: "Sends the user a push notification.",
        inputSchema: {
            type: "object",
            properties: { body: { type: "string" } },
            required: ["body"],
        },
    },
];

const pidFile = process.argv[2];
if (!pidFile) throw new Error("usage: stub-mcp-server.fixture.ts <pid-file>");
await Bun.write(pidFile, String(process.pid));

function reply(id: number | string, result: unknown): void {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

for await (const line of console) {
    const text = line.trim();
    if (!text) continue;
    const message = JSON.parse(text) as JsonRpcMessage;
    if (message.id === undefined) continue;
    switch (message.method) {
        case "initialize":
            reply(message.id, {
                protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "stub", version: "0.0.0" },
            });
            break;
        case "tools/list":
            reply(message.id, { tools: TOOLS });
            break;
        case "tools/call":
            reply(message.id, {
                content: [
                    {
                        type: "text",
                        text: `${message.params?.name} answered ${JSON.stringify(message.params?.arguments ?? {})}`,
                    },
                ],
            });
            break;
        default:
            reply(message.id, {});
    }
}
