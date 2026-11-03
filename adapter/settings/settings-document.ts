import { createHash } from "node:crypto";
import { z } from "zod/v4";

export const SETTINGS_FILENAME = "settings.json";

/**
 * A saved default model and its thinking level, both null when none is saved, whether a slow
 * command moves to the background on its own, null when the file does not set it, and the
 * credential each model provider is bound to: a Pico reference, never a secret (proposal.0009).
 */
export interface PicoSettings {
    defaultModel: string | null;
    defaultThinking: string | null;
    autoBackground: boolean | null;
    providerCredentials: Record<string, string>;
}

export type SettingsState =
    | { status: "missing"; revision: "none"; item: PicoSettings }
    | { status: "valid"; revision: string; item: PicoSettings }
    | { status: "unsupported" | "invalid"; revision: string; problem: string };

/** Pico's own auto-background value, used by a session whose settings file leaves it unset. */
export const DEFAULT_AUTO_BACKGROUND = true;

/** The version a save writes. Version 1, which has no bindings, is still read (proposal.0009). */
const VERSION = 2;

/** A provider id and a credential reference are both opaque, non-empty, non-secret text. */
const identifier = z.string().min(1);

/** The members every settings version defines. */
const sharedMembers = {
    defaultModel: identifier.optional(),
    defaultThinking: identifier.optional(),
    autoBackground: z.boolean().optional(),
};

/** A default model and its thinking level are saved together or not at all (proposal.0007). */
function pairedDefault(
    context: z.core.ParsePayload<{ defaultModel?: string; defaultThinking?: string }>,
): void {
    const { defaultModel, defaultThinking } = context.value;
    if ((defaultModel === undefined) === (defaultThinking === undefined)) return;
    const missing = defaultModel === undefined ? "defaultModel" : "defaultThinking";
    const present = missing === "defaultModel" ? "defaultThinking" : "defaultModel";
    context.issues.push({
        code: "custom",
        input: context.value,
        path: [missing],
        message: `missing member, required beside "${present}"`,
    });
}

const settingsDocumentV1 = z
    .strictObject({ version: z.literal(1), ...sharedMembers })
    .check(pairedDefault);

const settingsDocumentV2 = z
    .strictObject({
        version: z.literal(VERSION),
        ...sharedMembers,
        providerCredentials: z.record(identifier, identifier).optional(),
    })
    .check(pairedDefault);

type SettingsDocument = z.infer<typeof settingsDocumentV2>;

/** Reads the settings file's bytes, or `undefined` when there is no file. */
export function readSettingsState(bytes: Uint8Array | undefined): SettingsState {
    if (bytes === undefined) {
        return {
            status: "missing",
            revision: "none",
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                providerCredentials: {},
            },
        };
    }
    const revision = revisionOf(bytes);
    const parsed = parseObject(bytes);
    if ("problem" in parsed) return { status: "invalid", revision, problem: parsed.problem };

    const version = parsed.object["version"];
    if (version === undefined) {
        return { status: "invalid", revision, problem: "$.version: missing member" };
    }
    if (typeof version === "number" && Number.isInteger(version) && version > VERSION) {
        const problem = `$.version: settings version ${version} was written by a newer version of Pico`;
        return { status: "unsupported", revision, problem };
    }

    // Version 1 knows no bindings, and reading it neither invents nor rewrites any (proposal.0009).
    const document =
        version === 1
            ? settingsDocumentV1.safeParse(parsed.object)
            : settingsDocumentV2.safeParse(parsed.object);
    if (!document.success) {
        return { status: "invalid", revision, problem: describeIssue(document.error.issues[0]) };
    }
    return {
        status: "valid",
        revision,
        item: {
            defaultModel: document.data.defaultModel ?? null,
            defaultThinking: document.data.defaultThinking ?? null,
            autoBackground: document.data.autoBackground ?? null,
            providerCredentials:
                "providerCredentials" in document.data
                    ? { ...document.data.providerCredentials }
                    : {},
        },
    };
}

/** The bytes a save writes: the complete document, indented by four spaces. */
export function serializeSettings(item: PicoSettings): string {
    return `${JSON.stringify(settingsDocument(item), null, 4)}\n`;
}

export function revisionOf(bytes: Uint8Array | undefined): string {
    if (bytes === undefined) return "none";
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function settingsDocument(item: PicoSettings): SettingsDocument {
    const { defaultModel, defaultThinking, autoBackground } = item;
    if ((defaultModel === null) !== (defaultThinking === null)) {
        throw new Error("a default model and its thinking level are saved together");
    }
    const providerCredentials = canonicalBindings(item.providerCredentials);
    return {
        version: VERSION,
        ...(defaultModel !== null && defaultThinking !== null
            ? { defaultModel, defaultThinking }
            : {}),
        ...(autoBackground === null ? {} : { autoBackground }),
        ...(providerCredentials && { providerCredentials }),
    };
}

/**
 * The bindings in one provider order, so the same selection always serializes to the same bytes
 * and therefore the same revision, and `undefined` when nothing is bound.
 */
function canonicalBindings(bindings: Record<string, string>): Record<string, string> | undefined {
    const providers = Object.keys(bindings).sort();
    if (providers.length === 0) return undefined;
    const canonical: Record<string, string> = {};
    for (const provider of providers) {
        const reference = bindings[provider];
        if (provider.length === 0 || reference === undefined || reference.length === 0) {
            throw new Error("a provider binding names a provider and a credential reference");
        }
        canonical[provider] = reference;
    }
    return canonical;
}

type ParsedDocument = { object: Record<string, unknown> } | { problem: string };

function parseObject(bytes: Uint8Array): ParsedDocument {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return { problem: "$: not UTF-8 text" };
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return {
            problem: `$: not JSON: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { problem: `$: expected an object, found ${describeValue(value)}` };
    }
    return { object: value as Record<string, unknown> };
}

function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    return `a ${typeof value}`;
}

function describeIssue(issue: z.core.$ZodIssue): string {
    const path = `$${issue.path.map(segment => `.${String(segment)}`).join("")}`;
    if (issue.code === "unrecognized_keys") {
        return `${path}: unknown member ${JSON.stringify(issue.keys[0])}`;
    }
    if (issue.code === "invalid_key") {
        // The key is the last path segment, and an empty one would name nothing on its own.
        const member = `$${issue.path
            .slice(0, -1)
            .map(segment => `.${String(segment)}`)
            .join("")}`;
        return `${member}: invalid provider ${JSON.stringify(issue.path.at(-1))}`;
    }
    return `${path}: ${issue.message}`;
}
