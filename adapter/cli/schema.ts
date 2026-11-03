import { z } from "zod/v4";

import type { ArgumentSpec, CommandSpec, OptionSpec } from "./command.ts";
import type { commandSpecificationOutput, schemaIndexOutput } from "./result-schemas.ts";

import manifest from "../../package.json" with { type: "json" };
import { commandId, findCommand, usageOf } from "./command.ts";
import { CliError, exitCodeOf, retryableByDefault } from "./errors.ts";
import { COMMANDS } from "./registry.ts";
import { describeValueFormat } from "./values.ts";

export type SchemaIndex = z.infer<typeof schemaIndexOutput>;
export type CommandSpecification = z.infer<typeof commandSpecificationOutput>;

export function schemaIndex(): SchemaIndex {
    return {
        apiVersion: 1,
        version: manifest.version,
        commands: COMMANDS.map(command => ({
            command: commandId(command),
            summary: command.summary,
            effects: command.effects,
        })),
    };
}

export function commandSpecification(words: readonly string[]): CommandSpecification {
    const command = findCommand(words);
    if (!command) {
        const name = words.join(" ");
        throw new CliError("NOT_FOUND", `pico has no command "${name}"`, {
            details: {
                command: name,
                accepted: COMMANDS.map(known => commandId(known)),
            },
        });
    }
    return {
        apiVersion: 1,
        command: commandId(command),
        summary: command.summary,
        description: command.description,
        usage: usageOf(command),
        arguments: command.arguments.map(describeArgument),
        options: command.options.map(describeOption),
        effects: command.effects,
        dryRun: command.dryRun,
        idempotent: command.idempotent,
        output: z.toJSONSchema(command.output) as Record<string, unknown>,
        errors: command.errors.map(error => ({
            code: error.code,
            exitCode: exitCodeOf(error.code),
            retryable: retryableByDefault(error.code),
            when: error.when,
        })),
        examples: command.examples.map(example => ({ ...example })),
    };
}

function describeArgument(argument: ArgumentSpec): CommandSpecification["arguments"][number] {
    return {
        name: argument.name,
        description: argument.description,
        required: argument.required,
        variadic: argument.variadic,
        format: describeValueFormat(argument.format),
        accepted: null,
    };
}

function describeOption(option: OptionSpec): CommandSpecification["options"][number] {
    return {
        name: option.name,
        valueName: option.valueName ?? null,
        type: option.type,
        required: option.required,
        default: option.default ?? null,
        format: option.format ? describeValueFormat(option.format) : null,
        accepted: option.accepted ? acceptedOf(option.accepted) : null,
        description: option.description,
    };
}

function acceptedOf(
    accepted: NonNullable<CommandSpec["options"][number]["accepted"]>,
): NonNullable<CommandSpecification["options"][number]["accepted"]> {
    if (accepted.kind === "values") return { values: [...accepted.values] };
    if (accepted.kind === "format") return { format: accepted.format };
    return { command: accepted.command, description: accepted.description };
}
