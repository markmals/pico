/**
 * A zero-dependency stdio MCP server for the engine tests: newline-delimited
 * JSON-RPC on stdin/stdout, speaking just enough of MCP (`initialize`,
 * `tools/list`, `tools/call`) for OMP's MCP client to connect and call a tool.
 *
 * Flags select what the tests need:
 *   --pid-file <path>        write this process's pid, so a test can check it is gone
 *   --fail-tools-list        answer `initialize`, then fail `tools/list`
 *   --delay-tools-list <ms>  answer `tools/list` only after `<ms>`
 *   --instructions <text>    return `<text>` as the server's instructions
 *   --exit-after-initialize  answer `initialize`, then exit before `tools/list`
 *   --tool <name>            advertise `<name>` instead of the default tools (repeatable)
 *   --input-schema <json>    schema for tools selected with `--tool`
 *   --calls-file <path>      append each received tool call as JSONL
 */

import { appendFileSync } from "node:fs";

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: number | string;
    method: string;
    params?: Record<string, unknown>;
}

interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false };

const DEFAULT_TOOLS: ToolDefinition[] = [
    {
        name: "echo",
        description: "Returns the text it was given.",
        inputSchema: {
            type: "object",
            properties: { text: { type: "string", description: "Text to echo back." } },
            required: ["text"],
            additionalProperties: false,
        },
    },
    {
        name: "launch_report",
        description: "Reports how this server process was launched.",
        inputSchema: NO_ARGUMENTS,
    },
];

/** Environment variables the fixture reports back verbatim. */
const REPORTED_ENV_PREFIX = "PICO_FAKE_";

/** What a `launch_report` call returns, so a test can assert command, args and env reached the server. */
export interface LaunchReport {
    args: string[];
    env: Record<string, string>;
    /** The working directory the server was spawned in. */
    cwd: string;
}

function valuesOf(args: string[], flag: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === flag && args[index + 1] !== undefined) values.push(args[index + 1]!);
    }
    return values;
}

function reportedEnv(): Record<string, string> {
    const reported: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (name.startsWith(REPORTED_ENV_PREFIX) && value !== undefined) reported[name] = value;
    }
    return reported;
}

function send(message: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function callResult(args: string[], request: JsonRpcRequest): Record<string, unknown> {
    const name = request.params?.name;
    if (name === "launch_report") {
        const report: LaunchReport = { args, env: reportedEnv(), cwd: process.cwd() };
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
    }
    if (name === "echo") {
        const text = (request.params?.arguments as { text?: unknown } | undefined)?.text;
        return { content: [{ type: "text", text: typeof text === "string" ? text : "" }] };
    }
    return { content: [{ type: "text", text: `called ${String(name)}` }] };
}

async function handle(
    request: JsonRpcRequest,
    args: string[],
    tools: ToolDefinition[],
): Promise<void> {
    if (request.id === undefined) return;
    switch (request.method) {
        case "initialize": {
            const instructions = valuesOf(args, "--instructions")[0];
            send({
                id: request.id,
                result: {
                    protocolVersion: request.params?.protocolVersion ?? "2025-11-25",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "fake", version: "0.0.0" },
                    ...(instructions === undefined ? {} : { instructions }),
                },
            });
            if (args.includes("--exit-after-initialize")) process.exit(4);
            return;
        }
        case "tools/list": {
            if (args.includes("--fail-tools-list")) {
                send({
                    id: request.id,
                    error: { code: -32603, message: "fake server refuses to list tools" },
                });
                return;
            }
            const delay = valuesOf(args, "--delay-tools-list")[0];
            if (delay !== undefined) await Bun.sleep(Number(delay));
            send({ id: request.id, result: { tools } });
            return;
        }
        case "tools/call": {
            const callsFile = valuesOf(args, "--calls-file")[0];
            if (callsFile !== undefined) {
                appendFileSync(callsFile, `${JSON.stringify(request.params)}\n`);
            }
            send({ id: request.id, result: callResult(args, request) });
            return;
        }
        default:
            send({
                id: request.id,
                error: { code: -32601, message: `Method not found: ${request.method}` },
            });
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const pidFile = valuesOf(args, "--pid-file")[0];
    if (pidFile !== undefined) await Bun.write(pidFile, String(process.pid));

    const requested = valuesOf(args, "--tool");
    const inputSchema = valuesOf(args, "--input-schema")[0];
    const tools =
        requested.length > 0
            ? requested.map(name => ({
                  name,
                  description: `Fake ${name}.`,
                  inputSchema: inputSchema === undefined ? NO_ARGUMENTS : JSON.parse(inputSchema),
              }))
            : DEFAULT_TOOLS;

    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of Bun.stdin.stream()) {
        buffered += decoder.decode(chunk, { stream: true });
        let newline = buffered.indexOf("\n");
        while (newline !== -1) {
            const line = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            if (line.length > 0) await handle(JSON.parse(line) as JsonRpcRequest, args, tools);
            newline = buffered.indexOf("\n");
        }
    }
}

if (import.meta.main) await main();
