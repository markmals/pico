/** Extension fixtures for the engine tests: an extension that records every event it receives and registers a tool. */

import fs from "node:fs";
import path from "node:path";

const RECORDED_EVENTS = [
    "agent_start",
    "turn_start",
    "turn_end",
    "agent_end",
    "tool_execution_start",
    "tool_execution_end",
];

/**
 * Installs an extension that appends every event it receives to `logPath` and
 * registers a tool, so a test can see both whether hooks ran and whether an
 * extension's tool reached the roster.
 */
export function installRecordingExtension(extensionsDirectory: string, logPath: string): void {
    fs.mkdirSync(extensionsDirectory, { recursive: true });
    const source = `import fs from "node:fs";

const record = line => fs.appendFileSync(${JSON.stringify(logPath)}, line + "\\n");

export default function (pi) {
    for (const event of ${JSON.stringify(RECORDED_EVENTS)}) pi.on(event, async () => record(event));
    pi.on("tool_call", async event => record("tool_call " + event.toolName));
    pi.on("tool_result", async event => record("tool_result " + event.toolName));
    pi.registerTool({
        name: "extension_only_tool",
        label: "Extension Only",
        description: "A tool contributed by an extension.",
        parameters: pi.zod.object({}),
        async execute() {
            return { content: [{ type: "text", text: "ran" }] };
        },
    });
}
`;
    fs.writeFileSync(path.join(extensionsDirectory, "recorder.ts"), source);
}

/** The events the installed extension recorded, in order. */
export function recordedExtensionEvents(logPath: string): string[] {
    if (!fs.existsSync(logPath)) return [];
    return fs
        .readFileSync(logPath, "utf8")
        .split("\n")
        .filter(line => line.length > 0);
}

/**
 * Installs an extension that calls `process.exit` while its module is being
 * imported, the way a misbehaving extension takes its host down. Returns the
 * file an error message has to name.
 */
export function installExitingExtension(extensionsDirectory: string, exitCode = 7): string {
    fs.mkdirSync(extensionsDirectory, { recursive: true });
    const extensionPath = path.join(extensionsDirectory, "exiting.ts");
    fs.writeFileSync(
        extensionPath,
        `process.exit(${exitCode});\n\nexport default function () {}\n`,
    );
    return extensionPath;
}
