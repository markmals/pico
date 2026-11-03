import type { AcceptedValues, ArgumentSpec, CommandSpec, OptionSpec } from "./command.ts";

import { commandId, usageOf } from "./command.ts";
import { exitCodeOf, retryableByDefault } from "./errors.ts";
import { COMMANDS } from "./registry.ts";
import { describeValueFormat } from "./values.ts";

const ORIENTATION = [
    "pico is Pico's command line. Run with no arguments it is the ACP agent Sesh launches,",
    "speaking the Agent Client Protocol over stdin and stdout. Its commands show the models",
    "a session can use and change what new sessions start on.",
    "",
    "Commands except auth login print one JSON document on stdout; ordinary failures leave it",
    "empty. auth login streams JSON Lines, or one preview document with --dry-run.",
    "A failure ends stderr with a JSON error carrying a code, a message, whether a retry could",
    "help, and details. That error and the nonzero exit are authoritative if stdout closes.",
    "The exit status is 2 for a mistake in the command itself and 1 for anything else.",
];

const DISCOVERY = [
    ['pico cli search "<task>"', "rank the commands for a task described in words"],
    ["pico schema <command>", "one command's options, output and errors, as JSON"],
    ["pico <command> --help", "one command's usage, options and examples"],
    ["pico --version", "the version of pico"],
    ["pico settings update --dry-run", "preview a settings change before writing it"],
];

export function rootHelp(): string {
    const width = Math.max(...COMMANDS.map(command => commandId(command).length));
    const commands = COMMANDS.map(
        command => `  ${commandId(command).padEnd(width)}  ${command.summary}`,
    );
    const discovery = DISCOVERY.map(([invocation, purpose]) => `  ${invocation}\n      ${purpose}`);

    return [
        ...ORIENTATION,
        "",
        "usage: pico [--version] [--help] <command> [options]",
        "",
        "Commands:",
        ...commands,
        "",
        "Discovering the rest:",
        ...discovery,
        "",
    ].join("\n");
}

export function commandHelp(command: CommandSpec): string {
    const lines = [
        `usage: ${usageOf(command)}`,
        "",
        command.summary,
        "",
        command.description,
        "",
        ...block("Arguments", command.arguments.map(argumentHelp)),
        ...block("Options", command.options.map(optionHelp)),
        ...facts(command),
        ...block(
            "Errors",
            command.errors.map(
                error =>
                    `  ${error.code} (exit ${exitCodeOf(error.code)}, retryable: ${
                        retryableByDefault(error.code) ? "yes" : "no"
                    })\n      ${error.when}`,
            ),
        ),
        ...block(
            "Examples",
            command.examples.map(example => `  ${example.description}\n      ${example.command}`),
        ),
    ];
    return `${lines.join("\n").trimEnd()}\n`;
}

function block(title: string, entries: readonly string[]): string[] {
    if (entries.length === 0) return [];
    return [`${title}:`, ...entries, ""];
}

function facts(command: CommandSpec): string[] {
    const lines = [
        `Effects: ${command.effects}`,
        `Idempotent: ${command.idempotent ? "yes" : "no"}`,
    ];
    if (command.outputMode === "json-lines") {
        lines.push(
            "Output: one JSON document per line while it runs, ending in one completed or failed event",
        );
    }
    if (command.platform !== "any") lines.push(`Needs: ${command.platform}`);
    if (command.dryRun) lines.push("Supports --dry-run, which does everything except write");
    for (const constraint of command.constraints) lines.push(`Requires: ${constraint.description}`);
    return [...lines, ""];
}

function argumentHelp(argument: ArgumentSpec): string {
    const traits = [
        argument.required ? "required" : "optional",
        ...(argument.variadic ? ["repeated"] : []),
        describeValueFormat(argument.format),
    ];
    return `  <${argument.name}${argument.variadic ? "…" : ""}>\n      ${
        argument.description
    }\n      ${traits.join("; ")}`;
}

function optionHelp(option: OptionSpec): string {
    const traits = [
        option.type,
        ...(option.format ? [describeValueFormat(option.format)] : []),
        ...(option.required ? ["required"] : []),
        ...(option.default === undefined ? [] : [`default: ${String(option.default)}`]),
    ];
    const accepted = option.accepted ? [`      values: ${describeAccepted(option.accepted)}`] : [];
    const name = option.valueName ? `${option.name} <${option.valueName}>` : option.name;
    return [
        `  ${name}`,
        `      ${option.description}`,
        `      ${traits.join("; ")}`,
        ...accepted,
    ].join("\n");
}

function describeAccepted(accepted: AcceptedValues): string {
    if (accepted.kind === "values") return accepted.values.join(", ");
    if (accepted.kind === "format") return accepted.format;
    return `${accepted.description}, from \`${accepted.command}\``;
}
