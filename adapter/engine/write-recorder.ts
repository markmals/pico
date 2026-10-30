import type {
    ExtensionAPI,
    PreparedExtension,
    ToolCallEvent,
    ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import { resolvePath } from "@oh-my-pi/pi-coding-agent/extensibility/utils";
import { unwrapHashlineHeaderPath } from "@oh-my-pi/pi-coding-agent/tools/plan-mode-guard";
import { getEditInputPaths } from "@oh-my-pi/pi-tui/tools/edit";
import fs from "node:fs/promises";

/**
 * What one tool call did to one file: the text it replaced and the text it left,
 * or — when Pico could not read the file before or after the call — why not.
 */
export type RecordedChange =
    | {
          /** Absolute path of the file the tool call changed. */
          path: string;
          /** `null` when the file did not exist. */
          oldText: string | null;
          /** The file's content once the tool call finished, byte for byte; `""` when it was removed. */
          newText: string;
      }
    | {
          /** Absolute path of the file the tool call targeted. */
          path: string;
          /** The read failure that kept Pico from telling what changed. */
          unreadable: string;
      };

/** The synthetic source Pico's own extension reports; it loads no file. */
const PICO_WRITE_RECORDER = "<pico:write-recorder>";

/** One file as a tool left it, and when that change landed. */
interface Change {
    newText: string;
    at: number;
}

/**
 * A file as it stood at one moment: its content, absent, or unreadable for some
 * other reason. The third case is held apart from the second so an unreadable
 * file is never reported as a creation or a deletion that never happened.
 */
type FileState = { readonly text: string } | "missing" | { readonly unreadable: string };

/** One file as it stood before a tool call that may change it. */
interface Snapshot {
    path: string;
    before: FileState;
    at: number;
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readState(absolutePath: string): Promise<FileState> {
    try {
        return { text: await fs.readFile(absolutePath, "utf8") };
    } catch (error) {
        if (isMissing(error)) return "missing";
        return { unreadable: error instanceof Error ? error.message : String(error) };
    }
}

function isUnreadable(state: FileState): state is { readonly unreadable: string } {
    return state !== "missing" && "unreadable" in state;
}

function absolute(target: string, cwd: string): string | undefined {
    try {
        return resolvePath(target, cwd);
    } catch {
        return undefined;
    }
}

/**
 * The files a tool call is about to change: a `write`'s target — unwrapped from
 * a pasted hashline header exactly as the write tool unwraps it — or every file
 * named in an `edit`'s input. Targets that are not filesystem paths (`local://…`)
 * are left out.
 */
function targets(event: ToolCallEvent, cwd: string): string[] {
    if (event.toolName === "write") {
        if (!("path" in event.input)) return [];
        const target = event.input.path;
        if (typeof target !== "string") return [];
        const resolved = absolute(unwrapHashlineHeaderPath(target), cwd);
        return resolved === undefined ? [] : [resolved];
    }
    if (event.toolName !== "edit") return [];
    if (!("input" in event.input)) return [];
    const input = event.input.input;
    if (typeof input !== "string") return [];
    const resolved: string[] = [];
    for (const target of getEditInputPaths(input)) {
        const file = absolute(target, cwd);
        if (file !== undefined && !resolved.includes(file)) resolved.push(file);
    }
    return resolved;
}

/**
 * Records what each `write` and `edit` replaced, through a Pico-owned extension
 * rather than a client bridge: a bridged write skips OMP's own write path, which
 * is what keeps a replaced file's CRLF line endings and byte order mark. The
 * `tool_call` hook runs before the tool, so it sees the old content; the
 * `tool_result` hook runs after it, so it sees the bytes on disk — which also
 * covers the oversized edits whose snapshots OMP prunes out of its result.
 */
export class WriteRecorder {
    readonly #cwd: string;
    readonly #snapshots = new Map<string, Snapshot[]>();
    readonly #changed = new Map<string, Change>();
    readonly #records = new Map<string, RecordedChange[]>();
    #clock = 0;

    constructor(cwd: string) {
        this.#cwd = cwd;
    }

    /** Pico's own extension, bound alongside the user's. It registers no tools. */
    extension(): PreparedExtension {
        return {
            path: PICO_WRITE_RECORDER,
            resolvedPath: PICO_WRITE_RECORDER,
            error: null,
            factory: (pi: ExtensionAPI) => {
                pi.on("tool_call", event => this.#snapshot(event));
                pi.on("tool_result", event => this.#record(event));
                pi.on("agent_end", () => this.#endTurn());
            },
        };
    }

    /** Consumes what the tool call with this id changed, one entry per file. */
    take(toolCallId: string): RecordedChange[] {
        const records = this.#records.get(toolCallId) ?? [];
        this.#records.delete(toolCallId);
        return records;
    }

    async #snapshot(event: ToolCallEvent): Promise<void> {
        const files = targets(event, this.#cwd);
        if (files.length === 0) return;
        const snapshots: Snapshot[] = [];
        for (const file of files) {
            snapshots.push({ path: file, before: await readState(file), at: (this.#clock += 1) });
        }
        this.#snapshots.set(event.toolCallId, snapshots);
    }

    async #record(event: ToolResultEvent): Promise<void> {
        const snapshots = this.#snapshots.get(event.toolCallId);
        if (snapshots === undefined) return;
        this.#snapshots.delete(event.toolCallId);
        const records: RecordedChange[] = [];
        for (const snapshot of snapshots) {
            const change = event.isError ? undefined : await this.#changeOf(snapshot);
            if (change) {
                if ("newText" in change) {
                    this.#changed.set(change.path, {
                        newText: change.newText,
                        at: (this.#clock += 1),
                    });
                }
                records.push(change);
            }
            this.#forgetUnwatched(snapshot.path);
        }
        if (records.length > 0) this.#records.set(event.toolCallId, records);
    }

    /** What the call did to one of its targets, or why Pico cannot tell. */
    async #changeOf(snapshot: Snapshot): Promise<RecordedChange | undefined> {
        const after = await readState(snapshot.path);
        if (isUnreadable(after)) {
            return { path: snapshot.path, unreadable: after.unreadable };
        }
        // OMP prepares every tool call's arguments before it runs any of them, so
        // calls in one batch snapshot the same content. A change that landed after
        // this snapshot is what this call replaced. A file a `bash` command rewrote
        // inside the same batch is invisible here: nothing reports it, so the
        // snapshot stands.
        const overtaken = this.#changed.get(snapshot.path);
        const replaced =
            overtaken && overtaken.at > snapshot.at ? { text: overtaken.newText } : snapshot.before;
        if (isUnreadable(replaced)) {
            return { path: snapshot.path, unreadable: replaced.unreadable };
        }
        const oldText = replaced === "missing" ? null : replaced.text;
        // A file the call removed reports empty content, so a deletion still carries
        // its path and the text it had. A target that was absent and still is was
        // simply not touched.
        if (after === "missing") {
            return oldText === null ? undefined : { path: snapshot.path, oldText, newText: "" };
        }
        return { path: snapshot.path, oldText, newText: after.text };
    }

    /** Prior content is only worth keeping while a call that might have been overtaken is still pending. */
    #forgetUnwatched(filePath: string): void {
        for (const snapshots of this.#snapshots.values()) {
            if (snapshots.some(snapshot => snapshot.path === filePath)) return;
        }
        this.#changed.delete(filePath);
    }

    /** A call that never produced a result cannot be matched any more once the turn is over. */
    #endTurn(): void {
        this.#snapshots.clear();
        this.#changed.clear();
    }
}
