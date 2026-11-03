import { z } from "zod/v4";

const apiVersion = z.literal(1);
const revision = z.string().regex(/^(none|sha256:[0-9a-f]{64})$/);
const effects = z.enum(["none", "reads", "writes"]);
const errorCode = z.enum([
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "FAILED_PRECONDITION",
    "CONFLICT",
    "UNAVAILABLE",
    "IO_ERROR",
    "INTERNAL",
]);

const thinkingChoice = z.object({ value: z.string(), name: z.string() });

export const modelSchema = z.object({
    value: z.string(),
    name: z.string(),
    provider: z.string(),
    thinking: z.array(thinkingChoice),
    defaultThinking: z.string(),
});

export const modelsListOutput = z.object({
    apiVersion,
    credentialStore: z.string(),
    items: z.array(modelSchema),
});

export const modelsGetOutput = z.object({
    apiVersion,
    credentialStore: z.string(),
    item: modelSchema,
});

const savedSettings = z.object({
    defaultModel: z.string().nullable(),
    defaultThinking: z.string().nullable(),
    autoBackground: z.boolean().nullable(),
});

const effectiveSettings = z.object({
    defaultModel: z.string().nullable(),
    defaultThinking: z.string().nullable(),
    source: z.enum(["settings", "built-in"]),
    available: z.boolean(),
    autoBackground: z.boolean(),
});

export const settingsGetOutput = z.discriminatedUnion("status", [
    z.object({
        apiVersion,
        settingsFile: z.string(),
        status: z.literal("missing"),
        revision: z.literal("none"),
        item: savedSettings,
        effective: effectiveSettings,
    }),
    z.object({
        apiVersion,
        settingsFile: z.string(),
        status: z.literal("valid"),
        revision,
        item: savedSettings,
        effective: effectiveSettings,
    }),
    z.object({
        apiVersion,
        settingsFile: z.string(),
        status: z.enum(["unsupported", "invalid"]),
        revision,
        item: z.null(),
        effective: z.null(),
        problem: z.string(),
    }),
]);

const settingsSnapshot = z.object({ revision, item: savedSettings });

export const settingsUpdateOutput = z.object({
    apiVersion,
    settingsFile: z.string(),
    dryRun: z.boolean(),
    changed: z.boolean(),
    before: settingsSnapshot,
    after: settingsSnapshot,
});

const acceptedValues = z.union([
    z.object({ values: z.array(z.string()) }),
    z.object({ format: z.string() }),
    z.object({ command: z.string(), description: z.string() }),
]);

const argumentDescription = z.object({
    name: z.string(),
    description: z.string(),
    required: z.boolean(),
    variadic: z.boolean(),
    format: z.string(),
    accepted: acceptedValues.nullable(),
});

const optionDescription = z.object({
    name: z.string(),
    valueName: z.string().nullable(),
    type: z.enum(["string", "boolean"]),
    required: z.boolean(),
    default: z.union([z.string(), z.boolean()]).nullable(),
    format: z.string().nullable(),
    accepted: acceptedValues.nullable(),
    description: z.string(),
});

export const schemaIndexOutput = z.object({
    apiVersion,
    version: z.string(),
    commands: z.array(z.object({ command: z.string(), summary: z.string(), effects })),
});

export const commandSpecificationOutput = z.object({
    apiVersion,
    command: z.string(),
    summary: z.string(),
    description: z.string(),
    usage: z.string(),
    arguments: z.array(argumentDescription),
    options: z.array(optionDescription),
    effects,
    dryRun: z.boolean(),
    idempotent: z.boolean(),
    output: z.record(z.string(), z.unknown()),
    errors: z.array(
        z.object({
            code: errorCode,
            exitCode: z.number(),
            retryable: z.boolean(),
            when: z.string(),
        }),
    ),
    examples: z.array(z.object({ description: z.string(), command: z.string() })),
});

export const schemaOutput = z.union([schemaIndexOutput, commandSpecificationOutput]);

export const searchOutput = z.object({
    apiVersion,
    query: z.string(),
    items: z.array(z.object({ command: z.string(), summary: z.string(), usage: z.string() })),
});
