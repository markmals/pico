import type {
    ExtensionAPI,
    PreparedExtension,
    ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ClientBridge } from "@oh-my-pi/pi-coding-agent/session/client-bridge";

import { resolvePath } from "@oh-my-pi/pi-coding-agent/extensibility/utils";
import { unwrapHashlineHeaderPath } from "@oh-my-pi/pi-coding-agent/tools/plan-mode-guard";
import { getEditInputPaths } from "@oh-my-pi/pi-tui/tools/edit";
import fs from "node:fs/promises";
import path from "node:path";

import {
    applyTextFileConvention,
    readTextFileConvention,
    scanTextFileConvention,
    type TextFileConvention,
} from "./text-file-convention.ts";

/**
 * What one tool call did to one file: the text it replaced and the text it left,
 * or — when the file cannot be shown as a diff — why not.
 */
export type RecordedChange =
    | {
          /** Absolute path the engine wrote, after any hashline wrapper or extension rewrite. */
          path: string;
          /** `null` when the file did not exist. */
          oldText: string | null;
          /** The bytes the write left on disk, as text. */
          newText: string;
      }
    | {
          /** Absolute path the engine wrote. */
          path: string;
          /** Why there is no diff, as a phrase completing "Pico cannot show a diff because …". */
          noDiff: string;
      };

/** Files past this size are reported without a diff instead of being held in memory. */
const MAX_DIFF_BYTES = 1024 * 1024;

/** The synthetic source Pico's own extension reports; it loads no file. */
const PICO_WRITE_BRIDGE = "<pico:write-bridge>";

/** The file a write is replacing, and the text conventions it carries. */
type Previous =
    | { text: string; convention: TextFileConvention }
    | "missing"
    | { noDiff: string; convention: TextFileConvention | undefined };

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unreadable(error: unknown): Previous {
    if (isMissing(error)) return "missing";
    return {
        noDiff: `could not read it: ${error instanceof Error ? error.message : String(error)}`,
        convention: undefined,
    };
}

async function readPrevious(absolutePath: string): Promise<Previous> {
    let size: number;
    try {
        size = (await fs.stat(absolutePath)).size;
    } catch (error) {
        return unreadable(error);
    }
    if (size > MAX_DIFF_BYTES) {
        // The whole file stays off the heap, but its conventions still have to
        // reach the bytes being written, as OMP's own local write would. A file
        // that is writable but not readable fails here exactly as a small one does.
        try {
            return {
                noDiff: "it is larger than 1 MiB",
                convention: await scanTextFileConvention(absolutePath, size),
            };
        } catch (error) {
            return unreadable(error);
        }
    }
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(absolutePath);
    } catch (error) {
        return unreadable(error);
    }
    // A NUL byte or any invalid UTF-8 makes it binary, as OMP classifies it. The
    // decoder is finalized rather than streamed, so a sequence cut short at the
    // end of the file counts as invalid instead of being waved through.
    let text: string;
    try {
        // `ignoreBOM` keeps a leading byte order mark in the text, where OMP keeps it.
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return { noDiff: "it is a binary file", convention: undefined };
    }
    if (text.includes("\u0000")) return { noDiff: "it is a binary file", convention: undefined };
    return { text, convention: readTextFileConvention(bytes) };
}

/** Why the text a write produced cannot be shown as a diff, if it cannot. */
function undiffableText(text: string): string | undefined {
    // A lone surrogate is the one way a JavaScript string is not valid UTF-8.
    if (text.includes("\u0000") || /\p{Surrogate}/u.test(text)) return "it is a binary file";
    if (Buffer.byteLength(text, "utf8") > MAX_DIFF_BYTES) return "it is larger than 1 MiB";
    return undefined;
}

/** A string property of `value`, when it has one. */
function stringField(value: unknown, field: string): string | undefined {
    if (typeof value !== "object" || value === null || !(field in value)) return undefined;
    const held: unknown = (value as Record<string, unknown>)[field];
    return typeof held === "string" ? held : undefined;
}

/** Every path field `value` carries, appended to `into`. */
function collectPaths(value: unknown, into: string[]): void {
    for (const field of ["resolvedPath", "path", "sourcePath", "move"]) {
        const held = stringField(value, field);
        if (held !== undefined) into.push(held);
    }
}

/** The paths OMP's own result names, which is where its path recovery shows up. */
function resultPaths(event: ToolResultEvent): string[] {
    const details: unknown = "details" in event ? event.details : undefined;
    const named: string[] = [];
    collectPaths(details, named);
    if (typeof details === "object" && details !== null && "perFileResults" in details) {
        const entries: unknown = details.perFileResults;
        if (Array.isArray(entries)) for (const entry of entries) collectPaths(entry, named);
    }
    return named;
}

/** The paths the call's own effective input names. */
function inputPaths(event: ToolResultEvent): string[] {
    if (event.toolName === "write") {
        const target = "path" in event.input ? event.input.path : undefined;
        return typeof target === "string" ? [unwrapHashlineHeaderPath(target)] : [];
    }
    if (event.toolName !== "edit") return [];
    const input = "input" in event.input ? event.input.input : undefined;
    return typeof input === "string" ? [...getEditInputPaths(input)] : [];
}

/**
 * The files a finished `write` or `edit` really touched. OMP recovers a target
 * the input only half names — a hashline header carrying a bare basename — so
 * the paths its own result reports count as much as the ones the input names.
 */
function targets(event: ToolResultEvent, cwd: string): string[] {
    const resolved: string[] = [];
    for (const target of [...resultPaths(event), ...inputPaths(event)]) {
        try {
            const file = resolvePath(target, cwd);
            if (!resolved.includes(file)) resolved.push(file);
        } catch {
            // An internal URL is not a project file; OMP writes it itself.
        }
    }
    return resolved;
}

/**
 * Captures what every `write` and `edit` replaced by performing the write itself.
 *
 * OMP calls the client bridge from inside those tools with the absolute path the
 * call really resolved to — after a pasted hashline header is unwrapped and after
 * any extension rewrote the arguments — so the old and new text are read at the
 * one moment both are certain. Internal URLs and plan files never reach the
 * bridge; OMP writes those itself. A Pico-owned extension then files each record
 * under the tool call that produced it, from the call's own input rather than
 * from result details a user extension is free to replace.
 */
export class WriteBridge {
    readonly #cwd: string;
    readonly #writes = new Map<string, RecordedChange[]>();
    readonly #byCall = new Map<string, RecordedChange[]>();

    constructor(cwd: string) {
        this.#cwd = cwd;
    }

    readonly bridge: ClientBridge = {
        capabilities: { writeTextFile: true },
        writeTextFile: async ({ path: absolutePath, content }) => {
            await this.#write(absolutePath, content);
        },
    };

    /** Pico's own extension, bound alongside the user's. It registers no tools. */
    extension(): PreparedExtension {
        return {
            path: PICO_WRITE_BRIDGE,
            resolvedPath: PICO_WRITE_BRIDGE,
            error: null,
            factory: (pi: ExtensionAPI) => {
                pi.on("tool_result", event => {
                    this.#attribute(event);
                });
            },
        };
    }

    /** Consumes what the tool call with this id changed, one entry per affected file. */
    takeChanges(toolCallId: string): RecordedChange[] {
        const records = this.#byCall.get(toolCallId) ?? [];
        this.#byCall.delete(toolCallId);
        return records;
    }

    /** Drops records nothing took, so a write cannot be reported against a later turn. */
    clear(): void {
        this.#writes.clear();
        this.#byCall.clear();
    }

    /** A hook may never throw: a failure here would fail the tool call it reports on. */
    #attribute(event: ToolResultEvent): void {
        try {
            const records: RecordedChange[] = [];
            for (const file of targets(event, this.#cwd)) {
                const record = this.#writes.get(file)?.shift();
                if (record) records.push(record);
            }
            if (records.length > 0) this.#byCall.set(event.toolCallId, records);
        } catch {
            // Nothing to attribute is better than a failed tool call.
        }
    }

    async #write(absolutePath: string, content: string): Promise<void> {
        const previous = await readPrevious(absolutePath);
        const convention = previous === "missing" ? undefined : previous.convention;
        const text = applyTextFileConvention(content, convention);
        // A failed write is reported by OMP as a failed tool call and records nothing.
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, text);
        this.#record(absolutePath, previous, text);
    }

    #record(absolutePath: string, previous: Previous, newText: string): void {
        const noDiff =
            typeof previous === "object" && "noDiff" in previous
                ? previous.noDiff
                : undiffableText(newText);
        const record: RecordedChange =
            noDiff === undefined
                ? {
                      path: absolutePath,
                      oldText: previous === "missing" ? null : asText(previous),
                      newText,
                  }
                : { path: absolutePath, noDiff };
        const recorded = this.#writes.get(absolutePath);
        if (recorded) recorded.push(record);
        else this.#writes.set(absolutePath, [record]);
    }
}

function asText(previous: Previous): string | null {
    return typeof previous === "object" && "text" in previous ? previous.text : null;
}
