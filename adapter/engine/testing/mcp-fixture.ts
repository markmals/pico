/** MCP fixtures for the engine tests: ACP stdio entries for the fake server, and OMP's own MCP configuration. */

import type { McpServerStdio } from "@agentclientprotocol/sdk";

import fs from "node:fs";
import path from "node:path";

const FAKE_MCP_SERVER = path.join(import.meta.dir, "fake-mcp-server.ts");

export interface FakeMcpServerOptions {
    /** Flags for `fake-mcp-server.ts`, such as `--fail-tools-list` or `--tool <name>`. */
    flags?: string[];
    env?: Record<string, string>;
}

/** An ACP stdio entry that launches the fake MCP server. */
export function fakeMcpServer(name: string, options: FakeMcpServerOptions = {}): McpServerStdio {
    return {
        name,
        command: process.execPath,
        args: ["run", FAKE_MCP_SERVER, ...(options.flags ?? [])],
        env: Object.entries(options.env ?? {}).map(([variable, value]) => ({
            name: variable,
            value,
        })),
    };
}

/** An ACP stdio entry whose executable does not exist, so the server can never start. */
export function unstartableMcpServer(name: string): McpServerStdio {
    return { name, command: "/nonexistent/pico-no-such-mcp-server", args: [], env: [] };
}

/** Writes an OMP `mcp.json` naming `server`, the way a user or project configures their own MCP servers. */
export function writeOmpMcpConfig(configPath: string, server: McpServerStdio): void {
    const entry = {
        command: server.command,
        args: server.args,
        env: Object.fromEntries(server.env.map(variable => [variable.name, variable.value])),
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { [server.name]: entry } }, null, 4));
}

/** Resolves true when the process is gone, false when it outlives the wait. */
export async function exited(pid: number, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch {
            return true;
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 25);
        await promise;
    }
    return false;
}
