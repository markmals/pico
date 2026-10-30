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

export interface RecordedChange {
    /** Absolute path of the file the tool call changed. */
    path: string;
    /** `null` when the file did not exist. */
    oldText: string | null;
    /** The file's content once the tool call finished, byte for byte. */
    newText: string;
}

/** The synthetic source Pico's own extension reports; it loads no file. */
const PICO_WRITE_RECORDER = "<pico:write-recorder>";

/** One file as a tool left it, and when that change landed. */
interface Change {
    newText: string;
    at: number;
}

/** One file as it stood before a tool call that may change it. */
interface Snapshot {
    path: string;
    oldText: string | null;
    at: number;
}

async function readText(absolutePath: string): Promise<string | null> {
    try {
        return await fs.readFile(absolutePath, "utf8");
    } catch {
        return null;
    }
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
            snapshots.push({ path: file, oldText: await readText(file), at: (this.#clock += 1) });
        }
        this.#snapshots.set(event.toolCallId, snapshots);
    }

    async #record(event: ToolResultEvent): Promise<void> {
        const snapshots = this.#snapshots.get(event.toolCallId);
        if (snapshots === undefined) return;
        this.#snapshots.delete(event.toolCallId);
        const records: RecordedChange[] = [];
        for (const snapshot of snapshots) {
            const content = event.isError ? null : await readText(snapshot.path);
            // OMP prepares every tool call's arguments before it runs any of
            // them, so calls in one batch snapshot the same content. A change
            // that landed after this snapshot is what this call replaced. A
            // file a `bash` command rewrote inside the same batch is invisible
            // here: nothing reports it, so the snapshot stands.
            const overtaken = this.#changed.get(snapshot.path);
            const oldText =
                overtaken && overtaken.at > snapshot.at ? overtaken.newText : snapshot.oldText;
            // A file the call removed reports empty content, so a deletion still
            // carries its path and the text it had. A target that never existed
            // and still does not was simply not touched.
            const removed = content === null && oldText !== null && !event.isError;
            if (content !== null || removed) {
                const newText = content ?? "";
                this.#changed.set(snapshot.path, { newText, at: (this.#clock += 1) });
                records.push({ path: snapshot.path, oldText, newText });
            }
            this.#forgetUnwatched(snapshot.path);
        }
        if (records.length > 0) this.#records.set(event.toolCallId, records);
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
