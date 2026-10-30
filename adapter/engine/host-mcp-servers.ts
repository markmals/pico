import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import type { SourceMeta } from "@oh-my-pi/pi-coding-agent/capability/types";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
import type { MCPLoadResult } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";

import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";

import { PicoSessionError } from "./errors.ts";

export interface HostMcpServers {
    manager: MCPManager;
    tools: CustomTool[];
}

function toConfig(server: McpServerStdio): MCPServerConfig {
    // Null prototype: a `__proto__` environment key must become an own property.
    const env: Record<string, string> = Object.create(null);
    for (const variable of server.env) env[variable.name] = variable.value;
    return {
        type: "stdio",
        command: server.command,
        args: server.args,
        env,
        // The client's values are opaque: without this OMP runs a `!command`
        // value through a shell, replaces a value that names a host variable
        // with that variable's value, and drops empty values.
        envPolicy: "literal",
    };
}

function toSource(name: string): SourceMeta {
    return { provider: "acp", providerName: "ACP Client", path: `acp://${name}`, level: "project" };
}

/**
 * Connects exactly the servers the client sent. Nothing is read from the user's
 * or the project's MCP configuration, and a server that cannot be reached fails
 * the whole session rather than leaving a partial tool set behind.
 */
export async function connectHostMcpServers(
    cwd: string,
    servers: readonly McpServerStdio[],
    authStorage: AuthStorage,
): Promise<HostMcpServers> {
    const manager = new MCPManager(cwd);
    if (servers.length === 0) return { manager, tools: [] };

    manager.setAuthStorage(authStorage);
    // Null prototype again: `__proto__` is a legal, if hostile, server name.
    const configs: Record<string, MCPServerConfig> = Object.create(null);
    const sources: Record<string, SourceMeta> = Object.create(null);
    for (const server of servers) {
        if (server.name in configs) {
            throw new PicoSessionError(
                `The MCP server "${server.name}" was sent more than once; server names must be unique.`,
            );
        }
        configs[server.name] = toConfig(server);
        sources[server.name] = toSource(server.name);
    }

    const names = servers.map(server => server.name);
    // Startup timeout 0 asks OMP to wait for every server instead of dropping
    // whatever has not answered within its 250 ms discovery window — but
    // `OMP_MCP_STARTUP_TIMEOUT_MS` in the inherited environment overrides it,
    // and `OMP_MCP_TIMEOUT_MS=0` removes the per-request deadline altogether.
    // Pico's own rule is enforced below whatever the environment says.
    const result = await withDeadline(manager, names, () =>
        manager.connectServers(configs, sources, undefined, 0),
    );

    if (result.errors.size > 0) {
        await manager.disconnectAll();
        const failures = [...result.errors]
            .map(([name, cause]) => `"${name}": ${cause}`)
            .join("; ");
        throw new PicoSessionError(`Could not connect the MCP server ${failures}.`);
    }

    const connected = new Set(result.connectedServers);
    const missing = names.filter(name => !connected.has(name));
    if (missing.length > 0) {
        await manager.disconnectAll();
        throw new PicoSessionError(
            `The MCP server ${quoted(missing)} did not report its tools before startup finished.`,
        );
    }
    return { manager, tools: manager.getTools() };
}

/** Pico's own bound on the whole connection step, independent of OMP's request deadlines. */
const MCP_STARTUP_DEADLINE_MS = 30_000;

const DEADLINE = Symbol("mcp-startup-deadline");

function quoted(names: readonly string[]): string {
    return names.map(name => `"${name}"`).join(", ");
}

async function withDeadline(
    manager: MCPManager,
    names: readonly string[],
    connect: () => Promise<MCPLoadResult>,
): Promise<MCPLoadResult> {
    const { promise, resolve } = Promise.withResolvers<typeof DEADLINE>();
    const timer = setTimeout(() => resolve(DEADLINE), MCP_STARTUP_DEADLINE_MS);
    let outcome: MCPLoadResult | typeof DEADLINE;
    try {
        outcome = await Promise.race([connect(), promise]);
    } finally {
        clearTimeout(timer);
    }
    if (outcome !== DEADLINE) return outcome;

    const connected = new Set(manager.getConnectedServers());
    const stalled = names.filter(name => !connected.has(name));
    await manager.disconnectAll();
    throw new PicoSessionError(
        `MCP server ${quoted(stalled)} did not finish starting within ${MCP_STARTUP_DEADLINE_MS / 1000} s.`,
    );
}
