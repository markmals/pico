import type { ArgumentSpec, CommandInput, CommandSpec, OptionSpec } from "./command.ts";

import { commandId, findCommand, optionKey } from "./command.ts";
import { CliError } from "./errors.ts";
import { COMMANDS } from "./registry.ts";
import { describeValueFormat, isValidValue } from "./values.ts";

export type ParseResult =
    | { kind: "help"; command: CommandSpec }
    | { kind: "command"; command: CommandSpec; input: CommandInput };

const LONGEST_PATH = 2;

/**
 * The arguments after the executable, read against the registry. `--help` after a command's
 * path asks for its help, so a command line that cannot run still explains itself.
 */
export function parseArguments(args: readonly string[]): ParseResult {
    const command = selectCommand(args);
    const tokens = args.slice(command.path.length);
    if (tokens.includes("--help")) return { kind: "help", command };
    return { kind: "command", command, input: readInput(command, tokens) };
}

function selectCommand(args: readonly string[]): CommandSpec {
    for (let length = LONGEST_PATH; length > 0; length--) {
        const command = findCommand(args.slice(0, length));
        if (command) return command;
    }
    throw unknownCommand(args);
}

function unknownCommand(args: readonly string[]): CliError {
    const first = args[0] ?? "";
    const second = args[1];
    const resource = COMMANDS.some(command => command.path.length > 1 && command.path[0] === first);
    const argument =
        resource && second !== undefined && !second.startsWith("-") ? `${first} ${second}` : first;
    return new CliError("INVALID_ARGUMENT", `pico has no command "${argument}"`, {
        details: { argument, accepted: COMMANDS.map(command => commandId(command)) },
    });
}

function readInput(command: CommandSpec, tokens: readonly string[]): CommandInput {
    const options: Record<string, string | boolean> = {};
    const words: string[] = [];
    let index = 0;

    while (index < tokens.length) {
        const token = tokens[index++] as string;
        if (!token.startsWith("-")) {
            words.push(token);
            continue;
        }
        const [name, inlineValue] = splitOption(token);
        const option = command.options.find(declared => declared.name === name);
        if (!option) {
            throw new CliError(
                "INVALID_ARGUMENT",
                `${commandId(command)} has no option "${name}"`,
                {
                    details: {
                        argument: name,
                        accepted: command.options.map(declared => declared.name),
                    },
                },
            );
        }
        if (optionKey(name) in options) {
            throw new CliError("INVALID_ARGUMENT", `${name} is given more than once`, {
                details: { argument: name },
            });
        }
        if (option.type === "boolean") {
            if (inlineValue !== undefined) {
                throw new CliError("INVALID_ARGUMENT", `${name} takes no value`, {
                    details: { argument: name },
                });
            }
            options[optionKey(name)] = true;
            continue;
        }
        const following = tokens[index];
        if (inlineValue === undefined && (following === undefined || following.startsWith("--"))) {
            throw malformedValue(name, option.format ?? "text");
        }
        if (inlineValue === undefined) index++;
        options[optionKey(name)] = checkedValue(name, option, inlineValue ?? (following as string));
    }

    applyDefaults(command, options);
    checkConstraints(command, options);
    return { arguments: assignArguments(command, words), options };
}

function splitOption(token: string): [string, string | undefined] {
    const equals = token.indexOf("=");
    if (equals < 0) return [token, undefined];
    return [token.slice(0, equals), token.slice(equals + 1)];
}

function checkedValue(name: string, option: OptionSpec, value: string): string {
    const format = option.format ?? "text";
    if (!isValidValue(format, value)) throw malformedValue(name, format);
    const { accepted } = option;
    if (accepted?.kind === "values" && !accepted.values.includes(value)) {
        throw new CliError("INVALID_ARGUMENT", `${name} takes ${accepted.values.join(" or ")}`, {
            details: { argument: name, accepted: [...accepted.values] },
        });
    }
    return value;
}

function malformedValue(argument: string, format: Parameters<typeof isValidValue>[0]): CliError {
    const expected = describeValueFormat(format);
    return new CliError("INVALID_ARGUMENT", `${argument} takes ${expected}`, {
        details: { argument, expected },
    });
}

function applyDefaults(command: CommandSpec, options: Record<string, string | boolean>): void {
    for (const option of command.options) {
        const key = optionKey(option.name);
        if (key in options) continue;
        if (option.required) {
            throw new CliError("INVALID_ARGUMENT", `${option.name} is required`, {
                details: { argument: option.name },
            });
        }
        if (option.default !== undefined) options[key] = option.default;
    }
}

function checkConstraints(command: CommandSpec, options: Record<string, string | boolean>): void {
    for (const constraint of command.constraints) {
        const given = constraint.options.filter(name => optionKey(name) in options);
        if (given.length === 1) continue;
        if (given.length > 1 && constraint.kind === "at-least-one-of") continue;
        throw new CliError(
            "INVALID_ARGUMENT",
            `${commandId(command)} needs ${constraint.description}`,
            {
                details: {
                    command: commandId(command),
                    accepted: [...constraint.options],
                    ...(given.length > 1 ? { argument: given.join(" and ") } : {}),
                },
            },
        );
    }
}

function assignArguments(
    command: CommandSpec,
    words: readonly string[],
): Record<string, string | readonly string[]> {
    const assigned: Record<string, string | readonly string[]> = {};
    let index = 0;

    for (const argument of command.arguments) {
        if (argument.variadic) {
            const rest = words.slice(index);
            index = words.length;
            if (argument.required && rest.length === 0) throw missingArgument(argument);
            for (const word of rest) {
                if (!isValidValue(argument.format, word)) {
                    throw malformedValue(argument.name, argument.format);
                }
            }
            assigned[argument.name] = rest;
            continue;
        }
        const word = words[index];
        if (word === undefined) {
            if (argument.required) throw missingArgument(argument);
            continue;
        }
        index++;
        if (!isValidValue(argument.format, word)) {
            throw malformedValue(argument.name, argument.format);
        }
        assigned[argument.name] = word;
    }

    const extra = words[index];
    if (extra !== undefined) {
        throw new CliError(
            "INVALID_ARGUMENT",
            `${commandId(command)} takes no argument "${extra}"`,
            { details: { argument: extra } },
        );
    }
    return assigned;
}

function missingArgument(argument: ArgumentSpec): CliError {
    return new CliError("INVALID_ARGUMENT", `${argument.name} is required`, {
        details: { argument: argument.name, expected: describeValueFormat(argument.format) },
    });
}
