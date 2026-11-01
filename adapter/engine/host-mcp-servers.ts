import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import type { SourceMeta } from "@oh-my-pi/pi-coding-agent/capability/types";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
import type { MCPLoadResult } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";

import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import { createMCPToolName } from "@oh-my-pi/pi-coding-agent/mcp/tool-bridge";

import { PicoSessionError } from "./errors.ts";
import { constrainSeshDelegation } from "./sesh-delegation.ts";

export interface HostMcpServers {
    manager: MCPManager;
    tools: CustomTool[];
}

function toConfig(server: McpServerStdio, cwd: string): MCPServerConfig {
    // Null prototype: a `__proto__` environment key must become an own property.
    const env: Record<string, string> = Object.create(null);
    for (const variable of server.env) env[variable.name] = variable.value;
    return {
        type: "stdio",
        command: server.command,
        args: server.args,
        env,
        // Without this a server inherits Pico's own working directory, not the
        // session's, so a relative path it resolves points at the wrong project.
        cwd,
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
        configs[server.name] = toConfig(server, cwd);
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

    const folded = foldedToolName(manager, names);
    if (folded) {
        await manager.disconnectAll();
        const [first, second] = folded.tools;
        throw new PicoSessionError(
            `The MCP tools "${first.server}"/"${first.tool}" and "${second.server}"/"${second.tool}" would both ` +
                `be called "${folded.minted}" by Oh My Pi; rename one of them.`,
        );
    }

    const connected = new Set(result.connectedServers);
    const missing = names.filter(name => !connected.has(name));
    if (missing.length > 0) {
        await manager.disconnectAll();
        throw new PicoSessionError(
            `The MCP server ${quoted(missing)} did not report its tools before startup finished.`,
        );
    }
    try {
        const definition = manager
            .getConnection("sesh")
            ?.tools?.find(tool => tool.name === "start_session");
        const tools = manager
            .getTools()
            .map(tool =>
                tool.mcpServerName === "sesh" && tool.mcpToolName === "start_session"
                    ? constrainSeshDelegation(tool, definition?.inputSchema)
                    : tool,
            );
        return { manager, tools };
    } catch (error) {
        await manager.disconnectAll();
        throw error;
    }
}

/** One tool as a server advertises it. */
interface ServerTool {
    server: string;
    tool: string;
}

/**
 * The first pair of tools that mint one Oh My Pi tool name anywhere in the
 * session's namespace. Oh My Pi folds characters such as `-` and `_` together,
 * keeps one of the two and drops the other, so a session would silently run a
 * tool the model did not name. Two servers can collide as readily as two tools
 * of one server, because the server name is folded the same way.
 */
function foldedToolName(
    manager: MCPManager,
    names: readonly string[],
): { tools: [ServerTool, ServerTool]; minted: string } | undefined {
    const minted = new Map<string, ServerTool>();
    for (const server of names) {
        for (const tool of manager.getConnection(server)?.tools ?? []) {
            const name = createMCPToolName(server, tool.name);
            const first = minted.get(name);
            if (first !== undefined) {
                return { tools: [first, { server, tool: tool.name }], minted: name };
            }
            minted.set(name, { server, tool: tool.name });
        }
    }
    return undefined;
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

    // A server that answered `initialize` but never listed its tools is still a
    // live connection, so connection state alone would name nobody.
    const stalled = names.filter(name => manager.getConnection(name)?.tools === undefined);
    const unfinished = stalled.length > 0 ? stalled : names;
    await manager.disconnectAll();
    throw new PicoSessionError(
        `MCP server ${quoted(unfinished)} did not finish starting within ${MCP_STARTUP_DEADLINE_MS / 1000} s.`,
    );
}
