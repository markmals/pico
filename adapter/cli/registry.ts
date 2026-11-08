import type { CommandSpec } from "./command.ts";

import {
    authLoginOutput,
    credentialsCreateOutput,
    credentialsDeleteOutput,
    credentialsGetOutput,
    credentialsListOutput,
    intellisenseCheckOutput,
    modelsGetOutput,
    modelsListOutput,
    providersGetOutput,
    providersListOutput,
    providersUpdateOutput,
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
    outputMode: "document",
    platform: "any",
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
    outputMode: "document",
    platform: "any",
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
    outputMode: "document",
    platform: "any",
    output: modelsListOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An unknown option, or --provider without a value." },
        {
            code: "NOT_FOUND",
            when: "A provider's selected credential is no longer stored. details names the provider and its reference.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "Pico's settings file is unsupported or invalid, so the credentials it selects cannot be resolved.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked, or reading the item needs permission this command was not given.",
        },
        {
            code: "KEYCHAIN_ACCESS_DENIED",
            when: "Pico may not read a selected credential's Keychain item.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
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
    outputMode: "document",
    platform: "any",
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
            code: "FAILED_PRECONDITION",
            when: "Pico's settings file is unsupported or invalid, so the credentials it selects cannot be resolved.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked, or reading the item needs permission this command was not given.",
        },
        {
            code: "KEYCHAIN_ACCESS_DENIED",
            when: "Pico may not read a selected credential's Keychain item.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
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
        "Reads Pico's settings file and reports whether it is missing, valid, unsupported or invalid, with its revision, the settings saved in it, and what a new session would begin on now: the saved default model when there is one, otherwise OMP's built-in pick, and the auto-background state a session would attach with. It writes nothing, so it is also the way to check the file.",
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
    outputMode: "document",
    platform: "any",
    output: settingsGetOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An option was given; settings get takes none." },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
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
    summary:
        "Change the default model or thinking level, whether slow commands move to the background, and where the intellisense CLI is",
    description:
        "Saves the default model and thinking level in Pico's settings file. Given only --default-model, the saved thinking level is kept when the chosen model offers it, and replaced by that model's default level otherwise. Given only --default-thinking, the level applies to the saved default model. --auto-background decides whether a command still running after 60 seconds moves to the background on its own. --intellisense-path saves where the user's intellisense executable is, or auto to let Pico find it; the path must name a regular executable file, which this command never runs. Given alone, either of those two reads no model catalog, so it needs no credentials. Preview the receipt with --dry-run, and refuse a settings file that moved since you read it with --if-revision.",
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
        "background",
        "auto",
        "bash",
        "command",
        "job",
        "slow",
        "intellisense",
        "location",
        "path",
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
            name: "--auto-background",
            valueName: "state",
            type: "string",
            format: "text",
            required: false,
            default: undefined,
            accepted: { kind: "values", values: ["on", "off"] },
            description:
                "Whether a command still running after 60 seconds moves to the background on its own.",
        },
        {
            name: "--intellisense-path",
            valueName: "path",
            type: "string",
            format: "text",
            required: false,
            default: undefined,
            accepted: {
                kind: "format",
                format: "an absolute path to the intellisense executable, or auto",
            },
            description:
                "Where the user's intellisense executable is, or auto to find it automatically.",
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
            options: [
                "--default-model",
                "--default-thinking",
                "--auto-background",
                "--intellisense-path",
            ],
            description:
                "at least one of --default-model, --default-thinking, --auto-background or --intellisense-path",
        },
    ],
    effects: "writes",
    dryRun: true,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: settingsUpdateOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "None of --default-model, --default-thinking, --auto-background and --intellisense-path was given, a value is malformed or is not one the option accepts, the thinking level is one the model does not offer, or --intellisense-path is not absolute or names something that is not a regular executable file. details lists the accepted values when they are known.",
        },
        {
            code: "NOT_FOUND",
            when: "The model is not in the catalog, because it is unknown or has no usable credentials, or nothing exists at the --intellisense-path given.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "The settings file is unsupported or invalid, or --default-thinking was given with no saved default model.",
        },
        {
            code: "CONFLICT",
            when: "The file does not match --if-revision, or changed while the command prepared its save. Read the settings again and retry.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
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
            description: "Keep slow commands in the foreground",
            command: "pico settings update --auto-background off",
        },
        {
            description: "Choose where the intellisense executable is",
            command: "pico settings update --intellisense-path /opt/homebrew/bin/intellisense",
        },
        {
            description: "Let Pico find the intellisense executable again",
            command: "pico settings update --intellisense-path auto",
        },
        {
            description: "Refuse the update if the file moved since it was read",
            command:
                "pico settings update --default-model anthropic/claude-sonnet-5-5 --if-revision none",
        },
    ],
};

const providersList: CommandSpec = {
    path: ["providers", "list"],
    summary: "List the providers Pico knows, how to connect each, and what is selected",
    description:
        "Prints every model provider this Pico's engine declares, whether it accepts an API key, the engine's login methods and their destination providers, whether Pico can run each method, and the credential currently selected for that provider. It reads no Keychain item and makes no provider request, so it says what is configured, not what works.",
    keywords: [
        "providers",
        "provider",
        "list",
        "which",
        "connect",
        "methods",
        "available",
        "selected",
        "configured",
    ],
    arguments: [],
    options: [],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: providersListOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An option was given; providers list takes none." },
        {
            code: "FAILED_PRECONDITION",
            when: "Pico's settings file is unsupported or invalid, so the selections cannot be read.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory or settings file cannot be read." },
    ],
    examples: [
        {
            description: "List every provider and how to connect it",
            command: "pico providers list",
        },
    ],
};

const providersGet: CommandSpec = {
    path: ["providers", "get"],
    summary: "Show one provider, its login methods and the credential selected for it",
    description:
        "Prints one provider's entry from pico providers list, including the login methods Pico cannot run and the reason for each. An id the engine does not declare is not found.",
    keywords: [
        "providers",
        "provider",
        "show",
        "get",
        "methods",
        "login",
        "capabilities",
        "unsupported",
        "reason",
        "selected",
        "credential",
    ],
    arguments: [
        {
            name: "provider",
            description: "The provider's id, as pico providers list prints it.",
            required: true,
            variadic: false,
            format: "provider",
        },
    ],
    options: [],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: providersGetOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "The provider argument is missing or malformed." },
        {
            code: "NOT_FOUND",
            when: "This Pico's engine declares no such provider. details lists the command that prints the alternatives.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "Pico's settings file is unsupported or invalid, so the selection cannot be read.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory or settings file cannot be read." },
    ],
    examples: [
        {
            description: "Show one provider's login methods",
            command: "pico providers get openai-codex",
        },
    ],
};

const providersUpdate: CommandSpec = {
    path: ["providers", "update"],
    summary: "Select the credential a provider uses, or remove that selection",
    description:
        "Saves which stored credential Pico uses for one provider, or removes that selection with --disconnect. A selection must name an active credential belonging to that provider, and Pico reads its Keychain item to establish that it is there and valid before saving; that is not a claim that the provider accepts it. Disconnecting removes the reference only: it deletes no credential and revokes nothing at the provider. Every session, including one already open, uses the saved selection on its next request.",
    keywords: [
        "providers",
        "provider",
        "update",
        "select",
        "choose",
        "use",
        "credential",
        "bind",
        "binding",
        "connect",
        "disconnect",
        "remove",
        "unset",
        "stop",
        "switch",
        "account",
    ],
    arguments: [
        {
            name: "provider",
            description: "The provider whose selection changes.",
            required: true,
            variadic: false,
            format: "provider",
        },
    ],
    options: [
        {
            name: "--credential",
            valueName: "reference",
            type: "string",
            format: "reference",
            required: false,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico credentials list",
                description: "a reference it lists for this provider",
            },
            description: "The stored credential this provider uses.",
        },
        {
            name: "--disconnect",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: undefined,
            accepted: undefined,
            description: "Remove this provider's selection, keeping the credential stored.",
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
            description: "Refuse the change unless the settings file still has this revision.",
        },
        {
            name: "--allow-keychain-ui",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Let macOS ask you to allow this Keychain item, rather than failing without asking.",
        },
        {
            name: "--dry-run",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description: "Do everything except write the file, and check no Keychain item.",
        },
    ],
    constraints: [
        {
            kind: "exactly-one-of",
            options: ["--credential", "--disconnect"],
            description: "exactly one of --credential or --disconnect",
        },
    ],
    effects: "writes",
    dryRun: true,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: providersUpdateOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "The provider is missing or malformed, or neither or both of --credential and --disconnect was given.",
        },
        {
            code: "NOT_FOUND",
            when: "No such provider, or no stored credential with that reference.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "The settings file is unsupported or invalid, the credential belongs to another provider, or it is being deleted.",
        },
        {
            code: "CONFLICT",
            when: "--if-revision does not match the file. Read the settings again and retry.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked. Unlock it and retry the same command.",
        },
        {
            code: "KEYCHAIN_ACCESS_DENIED",
            when: "Pico may not read that credential's Keychain item, so it will not select it.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "The settings file or Pico's data directory cannot be used." },
    ],
    examples: [
        {
            description: "Preview selecting a credential, writing nothing",
            command:
                "pico providers update openai-codex --credential 0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b --dry-run",
        },
        {
            description: "Select a credential for a provider",
            command:
                "pico providers update openai-codex --credential 0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b",
        },
        {
            description: "Stop using any credential for a provider",
            command: "pico providers update openai-codex --disconnect",
        },
    ],
};

const credentialsList: CommandSpec = {
    path: ["credentials", "list"],
    summary: "List the credentials Pico has stored, with their accounts",
    description:
        "Prints Pico's stored credential references, the provider and kind of each, the account the provider reported, and whether one is being deleted. It reads Pico's own index, not Keychain, so it says what is stored rather than what can be read or used. --provider keeps one provider's credentials.",
    keywords: [
        "credentials",
        "credential",
        "list",
        "stored",
        "references",
        "accounts",
        "keys",
        "tokens",
        "which",
        "provider",
    ],
    arguments: [],
    options: [
        {
            name: "--provider",
            valueName: "provider",
            type: "string",
            format: "provider",
            required: false,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico providers list",
                description: "any provider it lists",
            },
            description: "Keep only the credentials stored for this provider.",
        },
    ],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: credentialsListOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "An unknown option, or --provider without a value." },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be read." },
    ],
    examples: [
        { description: "List every stored credential", command: "pico credentials list" },
        {
            description: "List one provider's credentials",
            command: "pico credentials list --provider openai",
        },
    ],
};

const credentialsGet: CommandSpec = {
    path: ["credentials", "get"],
    summary: "Show one stored credential and check that Pico can still read it",
    description:
        "Prints one reference's provider, kind and account, and reads its Keychain item to establish that it is present and valid. The stored secret is never printed, and no provider request or token refresh happens. A locked Keychain, a refused item and a missing item are different failures.",
    keywords: [
        "credentials",
        "credential",
        "get",
        "show",
        "check",
        "verify",
        "keychain",
        "readable",
        "reference",
        "account",
    ],
    arguments: [
        {
            name: "reference",
            description: "The credential's reference, as pico credentials list prints it.",
            required: true,
            variadic: false,
            format: "reference",
        },
    ],
    options: [
        {
            name: "--allow-keychain-ui",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Let macOS ask you to allow this Keychain item, rather than failing without asking.",
        },
    ],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    outputMode: "document",
    platform: "macos",
    output: credentialsGetOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "The reference is missing or is not one Pico issues." },
        { code: "NOT_FOUND", when: "Pico has no active credential with that reference." },
        {
            code: "FAILED_PRECONDITION",
            when: "This platform has no Keychain bridge, or the stored item does not match its reference.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked. Unlock it and retry the same command.",
        },
        { code: "KEYCHAIN_ACCESS_DENIED", when: "Pico may not read that Keychain item." },
        {
            code: "UNAVAILABLE",
            when: "The Keychain item behind this reference is gone, or Pico's credential index cannot be opened. Pico never answers with another account instead.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be read." },
    ],
    examples: [
        {
            description: "Check that a stored credential can still be read",
            command: "pico credentials get 0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b",
        },
    ],
};

const credentialsCreate: CommandSpec = {
    path: ["credentials", "create"],
    summary: "Store one API key, read privately from stdin, in the login Keychain",
    description:
        "Reads one API key from stdin and stores it in your login Keychain under a new reference. The key never appears in an argument, an environment variable, a prompt or the receipt. Pico removes one trailing line ending and nothing else, and refuses a terminal, empty input, a NUL character, bytes that are not UTF-8, and anything over 64 KiB. Storing a key selects nothing: use pico providers update to select it.",
    keywords: [
        "credentials",
        "credential",
        "create",
        "add",
        "store",
        "save",
        "api",
        "key",
        "token",
        "stdin",
        "paste",
        "secret",
        "keychain",
    ],
    arguments: [],
    options: [
        {
            name: "--provider",
            valueName: "provider",
            type: "string",
            format: "provider",
            required: true,
            default: undefined,
            accepted: {
                kind: "command",
                command: "pico providers list",
                description: "a provider it lists as taking an API key",
            },
            description: "The provider this key belongs to.",
        },
        {
            name: "--stdin",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: true,
            default: undefined,
            accepted: undefined,
            description: "Read the key from stdin; it is the only way to give one.",
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
                format: "none, or the revision pico credentials list printed",
            },
            description:
                "Refuse the change unless Pico's credential index still has this revision.",
        },
        {
            name: "--allow-keychain-ui",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Let macOS ask you to allow this Keychain item, rather than failing without asking.",
        },
        {
            name: "--dry-run",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Read and check the key, then report what would be stored without touching Keychain.",
        },
    ],
    constraints: [],
    effects: "writes",
    dryRun: true,
    idempotent: false,
    outputMode: "document",
    platform: "macos",
    output: credentialsCreateOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "--provider or --stdin is missing, or the key is empty, not UTF-8, holds a NUL character, is over 64 KiB, or came from a terminal.",
        },
        { code: "NOT_FOUND", when: "This Pico's engine declares no such provider." },
        {
            code: "FAILED_PRECONDITION",
            when: "This platform has no Keychain bridge, or the provider does not take a pasted API key. details says how it is connected instead.",
        },
        {
            code: "CONFLICT",
            when: "--if-revision does not match the credential index. Read it again and retry.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked. Unlock it and retry the same command.",
        },
        { code: "KEYCHAIN_ACCESS_DENIED", when: "Pico may not write the Keychain item." },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be used." },
    ],
    examples: [
        {
            description:
                "Check a key and the provider without storing anything, with the key piped in",
            command: "pico credentials create --provider openai --stdin --dry-run",
        },
        {
            description: "Store a key piped in from a file or a secret manager",
            command: "pico credentials create --provider openai --stdin",
        },
    ],
};

const credentialsDelete: CommandSpec = {
    path: ["credentials", "delete"],
    summary: "Delete one stored credential from Pico and the login Keychain",
    description:
        "Removes one reference from Pico's index and its item from your login Keychain. It revokes nothing at the provider and changes no other installation. A credential a provider still selects is refused: disconnect it or select another one first. A reference Pico does not have reports an unchanged receipt, so a repeated deletion finishes a half-done one.",
    keywords: [
        "credentials",
        "credential",
        "delete",
        "remove",
        "forget",
        "revoke",
        "revoked",
        "keychain",
        "reference",
    ],
    arguments: [
        {
            name: "reference",
            description: "The credential's reference, as pico credentials list prints it.",
            required: true,
            variadic: false,
            format: "reference",
        },
    ],
    options: [
        {
            name: "--if-revision",
            valueName: "revision",
            type: "string",
            format: "revision",
            required: false,
            default: undefined,
            accepted: {
                kind: "format",
                format: "none, or the revision pico credentials list printed",
            },
            description:
                "Refuse the change unless Pico's credential index still has this revision.",
        },
        {
            name: "--allow-keychain-ui",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Let macOS ask you to allow this Keychain item, rather than failing without asking.",
        },
        {
            name: "--dry-run",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description: "Report what deleting would remove, touching no Keychain item.",
        },
    ],
    constraints: [],
    effects: "writes",
    dryRun: true,
    idempotent: true,
    outputMode: "document",
    platform: "macos",
    output: credentialsDeleteOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "The reference is missing or is not one Pico issues." },
        {
            code: "FAILED_PRECONDITION",
            when: "This platform has no Keychain bridge, or a provider still selects this credential. details names the provider.",
        },
        {
            code: "CONFLICT",
            when: "--if-revision does not match the credential index. Read it again and retry.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked. Unlock it and retry the same command.",
        },
        {
            code: "KEYCHAIN_ACCESS_DENIED",
            when: "Pico may not delete that Keychain item; the credential stays recorded as being deleted.",
        },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened; a retry helps only when it reports that it is busy or locked.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be used." },
    ],
    examples: [
        {
            description: "Preview deleting a credential",
            command: "pico credentials delete 0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b --dry-run",
        },
        {
            description: "Delete a credential Pico no longer uses",
            command: "pico credentials delete 0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b",
        },
    ],
};

const authLogin: CommandSpec = {
    path: ["auth", "login"],
    summary: "Run one provider login and hand its authorization URL to the human",
    description:
        "Runs one login with the engine's own flow and prints a JSON document per line while it runs: the attempt, the authorization URL and instructions to give the human, progress, and finally the stored credential or a failure. It opens no browser, starts no terminal interface, and answers no question. Known input-dependent methods are refused before starting; an unexpected question aborts the flow. It reads nothing from stdin. A signal, closed output or ten-minute authorization deadline stops the SDK flow. The subsequent synchronous Keychain save is outside that deadline; dismiss an explicitly allowed macOS dialog to cancel a blocked native call. A stored credential is selected by pico providers update, not by this command.",
    keywords: [
        "auth",
        "login",
        "sign",
        "in",
        "oauth",
        "device",
        "browser",
        "url",
        "authorize",
        "authorization",
        "connect",
        "subscription",
        "account",
        "provider",
    ],
    arguments: [
        {
            name: "method",
            description: "The login method's id, as pico providers list prints it.",
            required: true,
            variadic: false,
            format: "provider",
        },
    ],
    options: [
        {
            name: "--allow-keychain-ui",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Let macOS ask you to allow this Keychain item, rather than failing without asking.",
        },
        {
            name: "--dry-run",
            valueName: undefined,
            type: "boolean",
            format: undefined,
            required: false,
            default: false,
            accepted: undefined,
            description:
                "Report the attempt Pico would run as one document, starting no login at all.",
        },
    ],
    constraints: [],
    effects: "writes",
    dryRun: true,
    idempotent: false,
    outputMode: "json-lines",
    platform: "macos",
    output: authLoginOutput,
    errors: [
        { code: "INVALID_ARGUMENT", when: "The method is missing or malformed." },
        { code: "NOT_FOUND", when: "This Pico's engine declares no such login method." },
        {
            code: "FAILED_PRECONDITION",
            when: "This platform has no Keychain bridge, Pico cannot run this method, or the flow asked a question Pico does not answer. details says which.",
        },
        { code: "AUTH_REQUIRED", when: "The provider refused the authorization." },
        { code: "CANCELLED", when: "A signal or a closed output stopped the attempt." },
        { code: "TIMED_OUT", when: "The authorization was not completed before the deadline." },
        {
            code: "CONFLICT",
            when: "Pico's credential index moved while the login ran, so the result was not stored.",
        },
        {
            code: "KEYCHAIN_LOCKED",
            when: "The login Keychain is locked. Unlock it and retry the same command.",
        },
        { code: "KEYCHAIN_ACCESS_DENIED", when: "Pico may not write the Keychain item." },
        {
            code: "UNAVAILABLE",
            when: "Pico's credential index cannot be opened, or the provider could not be reached.",
        },
        { code: "IO_ERROR", when: "Pico's data directory cannot be used." },
    ],
    examples: [
        {
            description: "Check that Pico can run a method before starting it",
            command: "pico auth login openai-codex-device --dry-run",
        },
        {
            description: "Start a login and relay its URL to the human",
            command: "pico auth login openai-codex-device",
        },
    ],
};

const intellisenseCheck: CommandSpec = {
    path: ["intellisense", "check"],
    summary: "Report where Pico finds the user's intellisense CLI, and whether it runs",
    description:
        "Resolves the location a new session would use — the path saved in Pico's settings, or the first intellisense executable in PATH, ~/.cargo/bin, ~/.local/bin, /opt/homebrew/bin and /usr/local/bin — then runs that program's --version once to prove Pico can use it. It changes nothing, reads no model catalog and opens no Keychain item. Choose a location with `pico settings update --intellisense-path`.",
    keywords: [
        "intellisense",
        "code intelligence",
        "executable",
        "location",
        "path",
        "find",
        "check",
        "version",
        "missing",
        "installed",
        "tool",
    ],
    arguments: [],
    options: [],
    constraints: [],
    effects: "reads",
    dryRun: false,
    idempotent: true,
    outputMode: "document",
    platform: "any",
    output: intellisenseCheckOutput,
    errors: [
        {
            code: "INVALID_ARGUMENT",
            when: "An argument or an option was given; intellisense check takes none.",
        },
        {
            code: "FAILED_PRECONDITION",
            when: "The settings file is unsupported or invalid, so the saved location cannot be read.",
        },
        { code: "IO_ERROR", when: "The settings file or Pico's data directory cannot be used." },
    ],
    examples: [
        {
            description: "Check that the agent's code intelligence tool is there and runs",
            command: "pico intellisense check",
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
    providersList,
    providersGet,
    providersUpdate,
    credentialsList,
    credentialsGet,
    credentialsCreate,
    credentialsDelete,
    authLogin,
    intellisenseCheck,
];
