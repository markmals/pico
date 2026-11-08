import { describe, expect, test } from "bun:test";

import type { CommandSpec, OptionSpec } from "./command.ts";

import { commandId, optionKey } from "./command.ts";
import { CliError, exitCodeOf } from "./errors.ts";
import { parseArguments } from "./parse.ts";
import { COMMANDS } from "./registry.ts";

const SAMPLE_VALUES = {
    model: "anthropic/claude-sonnet-5-5",
    provider: "openai",
    reference: "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b",
    revision: `sha256:${"a".repeat(64)}`,
    text: "high",
};

function sampleOptionValue(option: OptionSpec): string {
    if (option.accepted?.kind === "values") return option.accepted.values[0] as string;
    return SAMPLE_VALUES[option.format ?? "text"];
}

function sampleOptionArguments(option: OptionSpec): string[] {
    if (option.type === "boolean") return [option.name];
    return [option.name, sampleOptionValue(option)];
}

function sampleArgumentWords(command: CommandSpec): string[] {
    return command.arguments.flatMap(argument =>
        argument.required ? [SAMPLE_VALUES[argument.format]] : [],
    );
}

/** What a command needs besides the option under test, so it is not refused for something else. */
function otherRequirements(command: CommandSpec, option: OptionSpec): string[] {
    const required = command.options.flatMap(declared =>
        declared.required && declared.name !== option.name ? sampleOptionArguments(declared) : [],
    );
    const constrained = command.constraints.flatMap(constraint => {
        if (constraint.options.includes(option.name)) return [];
        const satisfying = command.options.find(
            declared => declared.name === constraint.options[0],
        );
        return satisfying ? sampleOptionArguments(satisfying) : [];
    });
    return [...required, ...constrained];
}

/** Splits an example command line the way a shell does, so examples are tested as typed. */
function tokenize(line: string): string[] {
    return (line.match(/"[^"]*"|\S+/g) ?? []).map(token => token.replace(/"/g, ""));
}

function failure(args: string[]): CliError {
    try {
        parseArguments(args);
    } catch (error) {
        if (error instanceof CliError) return error;
        throw error;
    }
    throw new Error(`expected ${args.join(" ")} to be refused`);
}

describe("proposal.0007 command line parser", () => {
    test("every option every command declares is accepted", () => {
        for (const command of COMMANDS) {
            for (const option of command.options) {
                const args = [
                    ...command.path,
                    ...sampleArgumentWords(command),
                    ...otherRequirements(command, option),
                    ...sampleOptionArguments(option),
                ];
                const parsed = parseArguments(args);

                expect({ args, kind: parsed.kind, command: commandId(parsed.command) }).toEqual({
                    args,
                    kind: "command",
                    command: commandId(command),
                });
                if (parsed.kind !== "command") continue;
                expect({ args, value: parsed.input.options[optionKey(option.name)] }).toEqual({
                    args,
                    value: option.type === "boolean" ? true : sampleOptionValue(option),
                });
            }
        }
    });

    test("an option the command does not declare is refused, with the ones it does", () => {
        const error = failure(["settings", "update", "--default-mode", "x"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({
            argument: "--default-mode",
            accepted: [
                "--default-model",
                "--default-thinking",
                "--auto-background",
                "--intellisense-path",
                "--if-revision",
                "--dry-run",
            ],
        });
    });

    test("an unknown command is refused, with the commands that exist", () => {
        const error = failure(["nope"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({
            argument: "nope",
            accepted: COMMANDS.map(command => commandId(command)),
        });
    });

    test("a resource without an operation is refused as an unknown command", () => {
        const error = failure(["models", "nope"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details.argument).toBe("models nope");
    });

    test("every example in the registry parses to its own command", () => {
        for (const command of COMMANDS) {
            for (const example of command.examples) {
                const args = tokenize(example.command).slice(1);
                const parsed = parseArguments(args);

                expect({ example: example.command, command: commandId(parsed.command) }).toEqual({
                    example: example.command,
                    command: commandId(command),
                });
            }
        }
    });

    test("settings update with none of its four settings is refused", () => {
        const error = failure(["settings", "update"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.message).toContain("--default-model");
        expect(error.details).toEqual({
            command: "settings update",
            accepted: [
                "--default-model",
                "--default-thinking",
                "--auto-background",
                "--intellisense-path",
            ],
        });
    });

    test("a model that is not provider/id is refused", () => {
        const error = failure(["settings", "update", "--default-model", "claude-sonnet-5-5"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details.argument).toBe("--default-model");
        expect(error.details.expected).toContain("provider/");
    });

    test("a revision that is not none or a sha256 digest is refused", () => {
        const error = failure([
            "settings",
            "update",
            "--default-thinking",
            "high",
            "--if-revision",
            "yesterday",
        ]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details.argument).toBe("--if-revision");
        expect(error.details.expected).toContain("sha256:");
    });

    test("an option written with an equals sign carries its value", () => {
        const parsed = parseArguments(["models", "list", "--provider=anthropic"]);

        expect(parsed.kind === "command" && parsed.input.options.provider).toBe("anthropic");
    });

    test("a boolean option takes no value", () => {
        const error = failure(["settings", "update", "--default-thinking", "high", "--dry-run=1"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details.argument).toBe("--dry-run");
    });

    test("an option whose value is missing is refused", () => {
        expect(failure(["models", "list", "--provider"]).details).toEqual({
            argument: "--provider",
            expected: "a value that is not empty",
        });
    });

    test("an option given twice is refused, naming it, in either spelling and for flags", () => {
        const cases: [string[], string][] = [
            [
                ["settings", "update", "--default-model", "a/b", "--default-model", "c/d"],
                "--default-model",
            ],
            [
                ["settings", "update", "--default-model=a/b", "--default-model", "c/d"],
                "--default-model",
            ],
            [
                ["settings", "update", "--default-model", "a/b", "--dry-run", "--dry-run"],
                "--dry-run",
            ],
        ];
        for (const [args, repeated] of cases) {
            const error = failure(args);

            expect(error.code).toBe("INVALID_ARGUMENT");
            expect(error.details.argument).toBe(repeated);
        }
    });

    test("a missing required argument is refused", () => {
        expect(failure(["models", "get"]).details.argument).toBe("model");
        expect(failure(["cli", "search"]).details.argument).toBe("query");
    });

    test("an argument a command does not take is refused", () => {
        expect(failure(["settings", "get", "extra"]).details.argument).toBe("extra");
    });

    test("a variadic argument collects every remaining word", () => {
        const parsed = parseArguments(["cli", "search", "change", "the", "default", "model"]);

        expect(parsed.kind === "command" && parsed.input.arguments.query).toEqual([
            "change",
            "the",
            "default",
            "model",
        ]);
    });

    test("schema takes the words of a command, or none", () => {
        const withWords = parseArguments(["schema", "settings", "update"]);
        const withoutWords = parseArguments(["schema"]);

        expect(withWords.kind === "command" && withWords.input.arguments.command).toEqual([
            "settings",
            "update",
        ]);
        expect(withoutWords.kind === "command" && withoutWords.input.arguments.command).toEqual([]);
    });

    test("--help after a command path asks for that command's help and runs nothing", () => {
        for (const args of [
            ["settings", "update", "--help"],
            ["settings", "update", "--default-model", "nonsense", "--help"],
        ]) {
            const parsed = parseArguments(args);

            expect({ args, kind: parsed.kind, command: commandId(parsed.command) }).toEqual({
                args,
                kind: "help",
                command: "settings update",
            });
        }
    });

    test("an option left out keeps its declared default", () => {
        const parsed = parseArguments(["settings", "update", "--default-thinking", "high"]);

        expect(parsed.kind === "command" && parsed.input.options).toEqual({
            defaultThinking: "high",
            dryRun: false,
        });
    });
});

describe("proposal.0008 an option that accepts named states", () => {
    test("--auto-background takes on and off", () => {
        for (const state of ["on", "off"]) {
            const parsed = parseArguments(["settings", "update", "--auto-background", state]);

            expect([state, parsed.kind === "command" && parsed.input.options]).toEqual([
                state,
                { autoBackground: state, dryRun: false },
            ]);
        }
    });

    test("any other value is refused, with the states the option accepts", () => {
        const error = failure(["settings", "update", "--auto-background", "maybe"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({
            argument: "--auto-background",
            accepted: ["on", "off"],
        });
        expect(exitCodeOf(error.code)).toBe(2);
    });
});

describe("proposal.0009 options that exclude one another", () => {
    const reference = "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b";

    test("providers update takes a credential or a disconnection, never both", () => {
        const error = failure([
            "providers",
            "update",
            "openai",
            "--credential",
            reference,
            "--disconnect",
        ]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.message).toContain("exactly one of --credential or --disconnect");
        expect(error.details).toEqual({
            command: "providers update",
            accepted: ["--credential", "--disconnect"],
            argument: "--credential and --disconnect",
        });
        expect(exitCodeOf(error.code)).toBe(2);
    });

    test("providers update with neither is refused the same way", () => {
        const error = failure(["providers", "update", "openai"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({
            command: "providers update",
            accepted: ["--credential", "--disconnect"],
        });
    });

    test("either one alone parses, keeping the provider as the argument", () => {
        for (const options of [["--credential", reference], ["--disconnect"]]) {
            const parsed = parseArguments(["providers", "update", "openai", ...options]);

            expect(parsed.kind === "command" && parsed.input.arguments).toEqual({
                provider: "openai",
            });
        }
    });

    test("a reference that is not one Pico issues is refused before anything opens", () => {
        const error = failure(["credentials", "get", "not-a-reference"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({
            argument: "reference",
            expected: "a credential reference, as pico credentials list prints it",
        });
    });

    test("credentials create refuses to run without the option that takes the key", () => {
        const error = failure(["credentials", "create", "--provider", "openai"]);

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.details).toEqual({ argument: "--stdin" });
    });
});
