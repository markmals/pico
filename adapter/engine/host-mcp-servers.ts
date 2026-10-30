import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import type { SourceMeta } from "@oh-my-pi/pi-coding-agent/capability/types";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
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

    // Startup timeout 0: wait for every server instead of dropping whatever has
    // not answered within OMP's 250 ms discovery window.
    const result = await manager.connectServers(configs, sources, undefined, 0);
    if (result.errors.size > 0) {
        await manager.disconnectAll();
        const failures = [...result.errors]
            .map(([name, cause]) => `"${name}": ${cause}`)
            .join("; ");
        throw new PicoSessionError(`Could not connect the MCP server ${failures}.`);
    }
    return { manager, tools: manager.getTools() };
}
