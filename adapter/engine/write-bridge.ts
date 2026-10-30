import type { ClientBridge } from "@oh-my-pi/pi-coding-agent/session/client-bridge";

import fs from "node:fs/promises";
import path from "node:path";

import { applyTextFileConvention, readTextFileConvention } from "./text-file-convention.ts";

/**
 * What one `write` did to one file: the text it replaced and the text it left,
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

/** The file a write is replacing: its text, nothing, or a reason it cannot be diffed. */
type Previous = { text: string; bytes: Uint8Array } | "missing" | { noDiff: string };

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unreadable(error: unknown): Previous {
    if (isMissing(error)) return "missing";
    return {
        noDiff: `could not read it: ${error instanceof Error ? error.message : String(error)}`,
    };
}

async function readPrevious(absolutePath: string): Promise<Previous> {
    let size: number;
    try {
        size = (await fs.stat(absolutePath)).size;
    } catch (error) {
        return unreadable(error);
    }
    if (size > MAX_DIFF_BYTES) return { noDiff: "it is larger than 1 MiB" };
    let bytes: Buffer;
    try {
        bytes = await fs.readFile(absolutePath);
    } catch (error) {
        return unreadable(error);
    }
    if (bytes.includes(0)) return { noDiff: "it is a binary file" };
    return { text: bytes.toString("utf8"), bytes };
}

/** Why the text a write produced cannot be shown as a diff, if it cannot. */
function undiffableText(text: string): string | undefined {
    if (text.includes("\u0000")) return "it is a binary file";
    if (Buffer.byteLength(text, "utf8") > MAX_DIFF_BYTES) return "it is larger than 1 MiB";
    return undefined;
}

/**
 * Captures what every `write` replaced by performing the write itself.
 *
 * OMP calls the client bridge from inside the `write` tool with the absolute
 * path the call really resolved to — after a pasted hashline header is unwrapped
 * and after any extension rewrote the arguments — so the old and new text are
 * read at the one moment both are certain, rather than reconstructed from what
 * the file looked like when the model's batch was prepared. Internal URLs and
 * plan files never reach the bridge; OMP writes those itself.
 */
export class WriteBridge {
    readonly #writes = new Map<string, RecordedChange[]>();

    readonly bridge: ClientBridge = {
        capabilities: { writeTextFile: true },
        writeTextFile: async ({ path: absolutePath, content }) => {
            await this.#write(absolutePath, content);
        },
    };

    /** Consumes, in order, what the writes to `absolutePath` replaced. */
    takeWrite(absolutePath: string): RecordedChange | undefined {
        return this.#writes.get(absolutePath)?.shift();
    }

    /** Drops records nothing took, so a write cannot be reported against a later turn. */
    clear(): void {
        this.#writes.clear();
    }

    async #write(absolutePath: string, content: string): Promise<void> {
        const previous = await readPrevious(absolutePath);
        const replacing = typeof previous === "object" && "text" in previous ? previous : undefined;
        const text = applyTextFileConvention(
            content,
            // A binary or unreadable file says nothing about text conventions, as in OMP.
            replacing && readTextFileConvention(replacing.bytes),
        );
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
