/**
 * A minimal stdio MCP server, spawned by shutdown tests so they can watch Pico
 * terminate the child it started. It serves the handshake and an empty tool list.
 *
 * Usage: bun stub-mcp-server.fixture.ts <pid-file>
 */

export {};

interface JsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: { protocolVersion?: string };
}

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
            reply(message.id, { tools: [] });
            break;
        default:
            reply(message.id, {});
    }
}
