import { createHash } from "node:crypto";
import { z } from "zod/v4";

export const SETTINGS_FILENAME = "settings.json";

/**
 * A saved default model and its thinking level, both null when none is saved, and whether a slow
 * command moves to the background on its own, null when the file does not set it.
 */
export interface PicoSettings {
    defaultModel: string | null;
    defaultThinking: string | null;
    autoBackground: boolean | null;
}

export type SettingsState =
    | { status: "missing"; revision: "none"; item: PicoSettings }
    | { status: "valid"; revision: string; item: PicoSettings }
    | { status: "unsupported" | "invalid"; revision: string; problem: string };

/** Pico's own auto-background value, used by a session whose settings file leaves it unset. */
export const DEFAULT_AUTO_BACKGROUND = true;

const VERSION = 1;

const settingsDocumentV1 = z
    .strictObject({
        version: z.literal(VERSION),
        defaultModel: z.string().min(1).optional(),
        defaultThinking: z.string().min(1).optional(),
        autoBackground: z.boolean().optional(),
    })
    .check(context => {
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
    });

type SettingsDocumentV1 = z.infer<typeof settingsDocumentV1>;

/** Reads the settings file's bytes, or `undefined` when there is no file. */
export function readSettingsState(bytes: Uint8Array | undefined): SettingsState {
    if (bytes === undefined) {
        return {
            status: "missing",
            revision: "none",
            item: { defaultModel: null, defaultThinking: null, autoBackground: null },
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

    const document = settingsDocumentV1.safeParse(parsed.object);
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

function settingsDocument(item: PicoSettings): SettingsDocumentV1 {
    const { defaultModel, defaultThinking, autoBackground } = item;
    const background = autoBackground === null ? {} : { autoBackground };
    if (defaultModel !== null && defaultThinking !== null) {
        return { version: VERSION, defaultModel, defaultThinking, ...background };
    }
    if (defaultModel !== null || defaultThinking !== null) {
        throw new Error("a default model and its thinking level are saved together");
    }
    return { version: VERSION, ...background };
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
    return `${path}: ${issue.message}`;
}
