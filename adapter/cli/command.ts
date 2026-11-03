import type { z } from "zod/v4";

import type { ErrorCode } from "./errors.ts";
import type { ValueFormat } from "./values.ts";

import { COMMANDS } from "./registry.ts";

export type Effects = "none" | "reads" | "writes";

export type AcceptedValues =
    | { kind: "values"; values: readonly string[] }
    | { kind: "format"; format: string }
    | { kind: "command"; command: string; description: string };

export type ArgumentSpec = {
    name: string;
    description: string;
    required: boolean;
    variadic: boolean;
    format: ValueFormat;
};

export type OptionSpec = {
    name: string;
    valueName: string | undefined;
    type: "string" | "boolean";
    format: ValueFormat | undefined;
    required: boolean;
    default: string | boolean | undefined;
    accepted: AcceptedValues | undefined;
    description: string;
};

export type ConstraintSpec = {
    kind: "at-least-one-of" | "exactly-one-of";
    options: readonly string[];
    description: string;
};

export type ErrorSpec = { code: ErrorCode; when: string };

export type ExampleSpec = { description: string; command: string };

export type CommandSpec = {
    path: readonly string[];
    summary: string;
    description: string;
    keywords: readonly string[];
    arguments: readonly ArgumentSpec[];
    options: readonly OptionSpec[];
    constraints: readonly ConstraintSpec[];
    effects: Effects;
    dryRun: boolean;
    idempotent: boolean;
    /**
     * How success reaches stdout: one JSON document, or one JSON document per line for the
     * single command that reports a flow while the human works through it.
     */
    outputMode: "document" | "json-lines";
    /** The platform the command needs; `any` is every platform Pico runs on. */
    platform: "any" | "macos";
    output: z.ZodType;
    errors: readonly ErrorSpec[];
    examples: readonly ExampleSpec[];
};

export type CommandInput = {
    arguments: Record<string, string | readonly string[]>;
    options: Record<string, string | boolean>;
};

export function commandId(command: CommandSpec): string {
    return command.path.join(" ");
}

/** The key an option's value takes in a command's input: `--default-model` sets `defaultModel`. */
export function optionKey(name: string): string {
    return name.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function usageOf(command: CommandSpec): string {
    const args = command.arguments.map(argument => {
        const placeholder = `<${argument.name}${argument.variadic ? "…" : ""}>`;
        return argument.required ? placeholder : `[${placeholder}]`;
    });
    const options = command.options.map(option => {
        const form =
            option.type === "boolean" ? option.name : `${option.name} <${option.valueName}>`;
        return option.required ? form : `[${form}]`;
    });
    return ["pico", ...command.path, ...args, ...options].join(" ");
}

export function findCommand(words: readonly string[]): CommandSpec | undefined {
    return COMMANDS.find(
        command =>
            command.path.length === words.length &&
            command.path.every((word, index) => word === words[index]),
    );
}
