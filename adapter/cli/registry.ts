import type { CommandSpec } from "./command.ts";

import {
    modelsGetOutput,
    modelsListOutput,
    schemaOutput,
    searchOutput,
    settingsGetOutput,
    settingsUpdateOutput,
} from "./result-schemas.ts";

const schema: CommandSpec = {
    path: ["schema"],
    summary: "Describe pico's commands as JSON, or one command in full",
    description:
        "Without words, prints the index of every command with its summary and effects. Given a command's words, prints that command's specification: its usage, arguments, options, effects, output schema, error codes and examples. It reads no file and needs no credentials.",
    keywords: [
        "schema",
        "specification",
        "json",
        "machine",
        "readable",
        "describe",
        "index",
        "discover",
        "contract",
        "options",
        "output",
    ],
    arguments: [
        {
            name: "command",
            description: "The words of one command. Without them, the index of every command.",
            required: false,
            variadic: true,
            format: "text",
        },
    ],
    options: [],
    constraints: [],
    effects: "none",
    dryRun: false,
    idempotent: true,
    output: schemaOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "An option was given; schema takes none.",
        },
        {
            code: "NOT_FOUND",
            when: "The words name no command. details lists the known commands.",
        },
    ],
    examples: [
        { description: "List every command", command: "pico schema" },
        {
            description: "Describe one command in full",
            command: "pico schema settings update",
        },
    ],
};

const cliSearch: CommandSpec = {
    path: ["cli", "search"],
    summary: "Find the commands for a task described in words",
    description:
        "Ranks pico's commands against the words you give and prints the best five, each with its usage. Case and accents are ignored. A query that matches nothing prints an empty list.",
    keywords: [
        "search",
        "find",
        "discover",
        "command",
        "commands",
        "query",
        "task",
        "suggest",
        "lookup",
        "ranked",
    ],
    arguments: [
        {
            name: "query",
            description: "The words describing what you want to do.",
            required: true,
            variadic: true,
            format: "text",
        },
    ],
    options: [],
    constraints: [],
    effects: "none",
    dryRun: false,
    idempotent: true,
    output: searchOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "No query words were given, or an option was given; cli search takes none.",
        },
    ],
    examples: [
        {
            description: "Find the command that saves a different default",
            command: 'pico cli search "change the default model"',
        },
    ],
};

const modelsList: CommandSpec = {
    path: ["models", "list"],
    summary: "List the models you can use, with their thinking choices",
    description:
        "Prints every model in Pico's catalog that has usable credentials, in the order Pico offers them, each with its thinking choices and its default thinking level. --provider narrows the list to one provider.",
    keywords: [
        "models",
        "model",
        "catalog",
        "available",
        "usable",
        "use",
        "which",
        "provider",
        "providers",
        "credentials",
        "list",
        "choices",
        "thinking",
    ],
    arguments: [],
    options: [
        {
            name: "--provider",
            valueName: "provider",
            type: "string",
            format: "text",
            required: false,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico models list",
                description: "the provider of any model it lists",
            },
            description: "Keep only the models whose provider is exactly this id.",
        },
    ],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    output: modelsListOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An unknown option, or --provider without a value." },
        {
            code: "UNAVAILABLE",
            when: "The credential store cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be used." },
        { code: "INTERNAL", when: "The catalog could not be resolved." },
    ],
    examples: [
        { description: "List every model you can use", command: "pico models list" },
        {
            description: "List one provider's models",
            command: "pico models list --provider anthropic",
        },
    ],
};

const modelsGet: CommandSpec = {
    path: ["models", "get"],
    summary: "Show one model and the thinking levels it offers",
    description:
        "Prints one catalog model: its provider, the thinking choices Pico offers for it, and the thinking level it begins on. A model that is unknown, or whose credentials are unusable, is not found.",
    keywords: [
        "models",
        "model",
        "show",
        "thinking",
        "levels",
        "reasoning",
        "provider",
        "choices",
        "details",
    ],
    arguments: [
        {
            name: "model",
            description: "The model's provider and id, as pico models list prints it.",
            required: true,
            variadic: false,
            format: "model",
        },
    ],
    options: [],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    output: modelsGetOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "The model argument is missing, or is not provider/id.",
        },
        {
            code: "NOT_FOUND",
            when: "No such model in the catalog. details names it and the command that lists the alternatives.",
        },
        {
            code: "UNAVAILABLE",
            when: "The credential store cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be used." },
        { code: "INTERNAL", when: "The catalog could not be resolved." },
    ],
    examples: [
        {
            description: "Show a model's thinking choices",
            command: "pico models get anthropic/claude-sonnet-5-5",
        },
    ],
};

const settingsGet: CommandSpec = {
    path: ["settings", "get"],
    summary: "Show Pico's settings and the model new sessions start on",
    description:
        "Reads Pico's settings file and reports whether it is missing, valid, unsupported or invalid, with its revision, the saved default, and what a new session would begin on now: the saved default when there is one, otherwise OMP's built-in pick. It writes nothing, so it is also the way to check the file.",
    keywords: [
        "settings",
        "configuration",
        "show",
        "status",
        "revision",
        "effective",
        "default",
        "what",
        "new",
        "sessions",
        "start",
        "current",
        "file",
        "check",
        "validate",
    ],
    arguments: [],
    options: [],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    output: settingsGetOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An option was given; settings get takes none." },
        {
            code: "UNAVAILABLE",
            when: "The credential store cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "The settings file or Pico's data directory cannot be used." },
        { code: "INTERNAL", when: "The catalog could not be resolved." },
    ],
    examples: [
        {
            description: "Show the settings and what a new session begins on",
            command: "pico settings get",
        },
    ],
};

const settingsUpdate: CommandSpec = {
    path: ["settings", "update"],
    summary: "Change the default model or thinking level for new sessions",
    description:
        "Saves the default model and thinking level in Pico's settings file. Given only --default-model, the saved thinking level is kept when the chosen model offers it, and replaced by that model's default level otherwise. Given only --default-thinking, the level applies to the saved default model. Preview the receipt with --dry-run, and refuse a settings file that moved since you read it with --if-revision.",
    keywords: [
        "settings",
        "update",
        "change",
        "set",
        "save",
        "write",
        "switch",
        "choose",
        "configure",
        "default",
        "model",
        "thinking",
        "level",
        "reasoning",
    ],
    arguments: [],
    options: [
        {
            name: "--default-model",
            valueName: "model",
            type: "string",
            format: "model",
            required: false,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico models list",
                description: "any model it lists",
            },
            description: "The model a new session begins on.",
        },
        {
            name: "--default-thinking",
            valueName: "level",
            type: "string",
            format: "text",
            required: false,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico models get <model>",
                description: "a thinking value the model offers",
            },
            description: "The thinking level a new session begins on.",
        },
        {
            name: "--if-revision",
            valueName: "revision",
            type: "string",
            format: "revision",
            required: false,
            default: undefined,
            accepted: {
                kind: "format",
                format: "none, or the revision pico settings get printed",
            },
            description: "Refuse the update unless the settings file still has this revision.",
        },
        {
            name: "--dry-run",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description: "Do everything except write the file.",
        },
    ],
    constraints: [
        {
            kind: "at-least-one-of",
            options: ["--default-model", "--default-thinking"],
            description: "at least one of --default-model or --default-thinking",
        },
    ],
    effects: "writes",
    dryRun: true,
    idempotent: true,
    output: settingsUpdateOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "Neither --default-model nor --default-thinking was given, a value is malformed, or the thinking level is one the model does not offer. details lists the accepted values when they are known.",
        },
        {
            code: "NOT_FOUND",
            when: "The model is not in the catalog, because it is unknown or has no usable credentials.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "The settings file is unsupported or invalid, or --default-thinking was given with no saved default model.",
        },
        {
            code: "CONFLICT",
            when: "--if-revision does not match the file. Read the settings again and retry.",
        },
        {
            code: "UNAVAILABLE",
            when: "The credential store cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        {
            code: "IO_ERROR",
            when: "The settings file or Pico's data directory could not be read or written.",
        },
        { code: "INTERNAL", when: "The catalog could not be resolved." },
    ],
    examples: [
        {
            description: "Preview a different default, writing nothing",
            command: "pico settings update --default-model anthropic/claude-sonnet-5-5 --dry-run",
        },
        {
            description: "Save a different default",
            command: "pico settings update --default-model anthropic/claude-sonnet-5-5",
        },
        {
            description: "Save a thinking level for the saved default model",
            command: "pico settings update --default-thinking high",
        },
        {
            description: "Refuse the update if the file moved since it was read",
            command:
                "pico settings update --default-model anthropic/claude-sonnet-5-5 --if-revision none",
        },
    ],
};

export const COMMANDS: readonly CommandSpec[] = [
    schema,
    cliSearch,
    modelsList,
    modelsGet,
    settingsGet,
    settingsUpdate,
];
