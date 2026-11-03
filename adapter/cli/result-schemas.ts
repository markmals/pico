import { z } from "zod/v4";

const apiVersion = z.literal(1);
const revision = z.string().regex(/^(none|sha256:[0-9a-f]{64})$/);
const effects = z.enum(["none", "reads", "writes"]);
const errorCode = z.enum([
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "FAILED_PRECONDITION",
    "CONFLICT",
    "AUTH_REQUIRED",
    "KEYCHAIN_LOCKED",
    "KEYCHAIN_ACCESS_DENIED",
    "CANCELLED",
    "TIMED_OUT",
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

/** The provider bindings a result was produced with: model provider to credential reference. */
const providerCredentials = z.record(z.string(), z.string());

export const modelsListOutput = z.object({
    apiVersion,
    providerCredentials,
    items: z.array(modelSchema),
});

export const modelsGetOutput = z.object({
    apiVersion,
    providerCredentials,
    item: modelSchema,
});

const savedSettings = z.object({
    defaultModel: z.string().nullable(),
    defaultThinking: z.string().nullable(),
    autoBackground: z.boolean().nullable(),
    providerCredentials,
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
    outputMode: z.enum(["document", "json-lines"]),
    platform: z.enum(["any", "macos"]),
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

/** One stored credential as a command reports it: identity and account facts, never payload. */
export const credentialSchema = z.object({
    reference: z.string(),
    provider: z.string(),
    kind: z.enum(["api_key", "oauth"]),
    state: z.enum(["active", "deleting"]),
    email: z.string().nullable(),
    accountId: z.string().nullable(),
    orgId: z.string().nullable(),
    orgName: z.string().nullable(),
});

const loginMethodSchema = z.object({
    method: z.string(),
    name: z.string(),
    provider: z.string(),
    interaction: z.enum(["browser-callback", "device-code", "api-key", "engine-defined"]),
    localBrowser: z.boolean().nullable(),
    supported: z.boolean(),
    unsupported: z.string().nullable(),
});

const providerSchema = z.object({
    provider: z.string(),
    name: z.string(),
    apiKey: z.boolean(),
    apiKeyUnsupported: z.string().nullable(),
    /** The reference the settings file selects, even when Pico no longer has it stored. */
    selected: z.string().nullable(),
    credential: credentialSchema.nullable(),
    methods: z.array(loginMethodSchema),
});

export const providersListOutput = z.object({ apiVersion, items: z.array(providerSchema) });

export const providersGetOutput = z.object({ apiVersion, item: providerSchema });

/** Whether a receipt established that the Keychain item behind a reference can be read. */
const keychainCheck = z.enum(["readable", "written", "deleted", "not-checked"]);

const binding = z.object({ revision, credential: z.string().nullable() });

export const providersUpdateOutput = z.object({
    apiVersion,
    settingsFile: z.string(),
    provider: z.string(),
    dryRun: z.boolean(),
    changed: z.boolean(),
    keychain: keychainCheck,
    before: binding,
    after: binding,
});

export const credentialsListOutput = z.object({
    apiVersion,
    revision,
    items: z.array(credentialSchema),
});

export const credentialsGetOutput = z.object({
    apiVersion,
    revision,
    keychain: keychainCheck,
    item: credentialSchema,
});

export const credentialsCreateOutput = z.object({
    apiVersion,
    provider: z.string(),
    dryRun: z.boolean(),
    changed: z.boolean(),
    keychain: keychainCheck,
    stored: z.boolean(),
    revision,
    credential: credentialSchema.nullable(),
    select: z.string(),
});

export const credentialsDeleteOutput = z.object({
    apiVersion,
    reference: z.string(),
    dryRun: z.boolean(),
    changed: z.boolean(),
    keychain: keychainCheck,
    revision,
    credential: credentialSchema.nullable(),
});

/** `auth login --dry-run`: the attempt Pico would run, with nothing authorized. */
export const authLoginPreviewOutput = z.object({
    apiVersion,
    dryRun: z.literal(true),
    method: z.string(),
    provider: z.string(),
    interaction: loginMethodSchema.shape.interaction,
    localBrowser: z.boolean().nullable(),
    deadlineSeconds: z.number(),
    revision,
    keychain: z.literal("not-checked"),
});

const event = { apiVersion, attemptId: z.string(), sequence: z.number().int().nonnegative() };

/**
 * `auth login`'s event stream, one JSON document per line. It is the only command whose
 * success is more than one document, and `failed` may follow events already on stdout.
 */
export const authLoginEventOutput = z.discriminatedUnion("type", [
    z.object({
        ...event,
        type: z.literal("started"),
        method: z.string(),
        provider: z.string(),
        deadlineSeconds: z.number(),
    }),
    z.object({
        ...event,
        type: z.literal("authorization"),
        url: z.string(),
        launchUrl: z.string().nullable(),
        instructions: z.string().nullable(),
        localBrowser: z.boolean(),
    }),
    z.object({ ...event, type: z.literal("progress"), message: z.string() }),
    z.object({
        ...event,
        type: z.literal("completed"),
        stored: z.literal(true),
        revision,
        credential: credentialSchema,
        select: z.string(),
    }),
    z.object({
        ...event,
        type: z.literal("failed"),
        error: z.object({
            code: errorCode,
            message: z.string(),
            retryable: z.boolean(),
            details: z.record(z.string(), z.unknown()),
        }),
    }),
]);

/** `auth login` prints either the preview document or the stream its events make up. */
export const authLoginOutput = z.union([authLoginPreviewOutput, authLoginEventOutput]);
