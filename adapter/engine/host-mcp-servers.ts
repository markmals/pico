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
    return {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: Object.fromEntries(server.env.map(variable => [variable.name, variable.value])),
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
    const configs: Record<string, MCPServerConfig> = {};
    const sources: Record<string, SourceMeta> = {};
    for (const server of servers) {
        configs[server.name] = toConfig(server);
        sources[server.name] = toSource(server.name);
    }

    const result = await manager.connectServers(configs, sources);
    if (result.errors.size > 0) {
        await manager.disconnectAll();
        const failures = [...result.errors]
            .map(([name, cause]) => `"${name}": ${cause}`)
            .join("; ");
        throw new PicoSessionError(`Could not connect the MCP server ${failures}.`);
    }
    return { manager, tools: manager.getTools() };
}
