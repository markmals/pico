import type {
    ExtensionAPI,
    PreparedExtension,
    ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ClientBridge } from "@oh-my-pi/pi-coding-agent/session/client-bridge";

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
    readonly #pending: RecordedChange[] = [];
    readonly #byCall = new Map<string, RecordedChange[]>();

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
        this.#pending.length = 0;
        this.#byCall.clear();
    }

    /**
     * Every record the bridge produced since the previous `write` or `edit`
     * finished belongs to this call: OMP declares both tools `concurrency:
     * "exclusive"`, so nothing else can have written in between. Reading the
     * call's paths instead would strand a record whose target OMP recovered or
     * whose failure details name no file at all.
     *
     * A hook may never throw: a failure here would fail the call it reports on.
     */
    #attribute(event: ToolResultEvent): void {
        try {
            if (event.toolName !== "write" && event.toolName !== "edit") return;
            const records = this.#pending.splice(0, this.#pending.length);
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
        this.#pending.push(
            noDiff === undefined
                ? {
                      path: absolutePath,
                      oldText: previous === "missing" ? null : asText(previous),
                      newText,
                  }
                : { path: absolutePath, noDiff },
        );
    }
}

function asText(previous: Previous): string | null {
    return typeof previous === "object" && "text" in previous ? previous.text : null;
}
