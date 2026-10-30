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
import path from "node:path";

/**
 * What one tool call did to one file: the text it replaced and the text it left,
 * or — when the file cannot be shown as a diff — why not.
 */
export type RecordedChange =
    | {
          /** Absolute path of the file the tool call changed, as the call named it. */
          path: string;
          /** `null` when the file did not exist. */
          oldText: string | null;
          /** The file's content once the tool call finished, byte for byte; `""` when it was removed. */
          newText: string;
      }
    | {
          /** Absolute path of the file the tool call targeted. */
          path: string;
          /** Why there is no diff, as a phrase completing "Pico cannot show a diff because …". */
          noDiff: string;
      };

/** Files past this size are reported without a diff instead of being held in memory. */
const MAX_DIFF_BYTES = 1024 * 1024;

/** The synthetic source Pico's own extension reports; it loads no file. */
const PICO_WRITE_RECORDER = "<pico:write-recorder>";

/** One file as a tool left it, and when that change landed. */
interface Change {
    after: FileState;
    at: number;
}

/**
 * A file as it stood at one moment: its content, absent, or unreadable for some
 * other reason. The third case is held apart from the second so an unreadable
 * file is never reported as a creation or a deletion that never happened.
 */
type FileState = { readonly text: string } | "missing" | { readonly noDiff: string };

/** One file as it stood before a tool call that may change it. */
interface Snapshot {
    /** The path the call named, which is what the user is shown. */
    path: string;
    /** The resolved real path, so a file and a symlink to it are one file. */
    key: string;
    before: FileState;
    at: number;
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unreadable(error: unknown): FileState {
    if (isMissing(error)) return "missing";
    return {
        noDiff: `could not read it: ${error instanceof Error ? error.message : String(error)}`,
    };
}

async function readState(absolutePath: string): Promise<FileState> {
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
    return { text: bytes.toString("utf8") };
}

function undiffable(state: FileState): state is { readonly noDiff: string } {
    return state !== "missing" && "noDiff" in state;
}

/** Symlink hops to follow before giving up on a cycle. */
const MAX_SYMLINK_HOPS = 32;

/**
 * The file a path really names, so a symlink and its target are one file. A
 * dangling link is followed too: `fs.realpath` fails on one, yet a call in the
 * same batch may be about to create its target.
 */
async function realPath(absolutePath: string): Promise<string> {
    let current = absolutePath;
    for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
        let link: string;
        try {
            link = await fs.readlink(current);
        } catch {
            break;
        }
        current = path.resolve(path.dirname(current), link);
    }
    try {
        return await fs.realpath(current);
    } catch {
        // A file that does not exist yet still has a real directory.
    }
    try {
        return path.join(await fs.realpath(path.dirname(current)), path.basename(current));
    } catch {
        return current;
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
function targets(event: ToolCallEvent | ToolResultEvent, cwd: string): string[] {
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
            snapshots.push({
                path: file,
                key: await realPath(file),
                before: await readState(file),
                at: (this.#clock += 1),
            });
        }
        this.#snapshots.set(event.toolCallId, snapshots);
    }

    async #record(event: ToolResultEvent): Promise<void> {
        const snapshots = this.#snapshots.get(event.toolCallId);
        if (snapshots === undefined) return;
        this.#snapshots.delete(event.toolCallId);
        // An extension's `tool_call` hook may have redirected the call. Oh My Pi
        // hands every hook the same original input and only aggregates the
        // revisions afterwards, so the effective target is first visible here.
        const effective = await this.#effectiveTargets(event, snapshots);
        const records: RecordedChange[] = [];
        if (!event.isError) {
            for (const target of effective) {
                const change = await this.#changeOf(target);
                if (change) records.push(change);
            }
        }
        for (const snapshot of snapshots) this.#forgetUnwatched(snapshot.key);
        for (const target of effective) this.#forgetUnwatched(target.key);
        if (records.length > 0) this.#records.set(event.toolCallId, records);
    }

    /** The files the call really touched, each paired with the state Pico saw before it ran. */
    async #effectiveTargets(event: ToolResultEvent, snapshots: Snapshot[]): Promise<Snapshot[]> {
        const files = targets(event, this.#cwd);
        if (files.length === 0) return snapshots;
        const seen = new Map(snapshots.map(snapshot => [snapshot.key, snapshot]));
        const effective: Snapshot[] = [];
        for (const file of files) {
            const key = await realPath(file);
            const snapshot = seen.get(key);
            effective.push(
                snapshot ?? {
                    path: file,
                    key,
                    // Pico never saw this file before the call, so it has no old text.
                    before: { noDiff: "an extension changed which file the call wrote" },
                    at: this.#clock,
                },
            );
        }
        return effective;
    }

    /** What the call did to one of its targets, or why Pico cannot tell. */
    async #changeOf(snapshot: Snapshot): Promise<RecordedChange | undefined> {
        // A change that landed after this snapshot is what this call replaced, so
        // the previous state is read before this call's own state replaces it.
        const overtaken = this.#changed.get(snapshot.key);
        const after = await readState(snapshot.path);
        this.#changed.set(snapshot.key, { after, at: (this.#clock += 1) });
        if (undiffable(after)) {
            return { path: snapshot.path, noDiff: after.noDiff };
        }
        // OMP prepares every tool call's arguments before it runs any of them, so
        // calls in one batch snapshot the same content. A change that landed after
        // this snapshot is what this call replaced, matched by real path so a file
        // and a symlink to it count as one. A file a `bash` command rewrote inside
        // the same batch is invisible here: nothing reports it, so the snapshot
        // stands.
        const replaced =
            overtaken && overtaken.at > snapshot.at ? overtaken.after : snapshot.before;
        if (undiffable(replaced)) {
            return { path: snapshot.path, noDiff: replaced.noDiff };
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
    #forgetUnwatched(key: string): void {
        for (const snapshots of this.#snapshots.values()) {
            if (snapshots.some(snapshot => snapshot.key === key)) return;
        }
        this.#changed.delete(key);
    }

    /** A call that never produced a result cannot be matched any more once the turn is over. */
    #endTurn(): void {
        this.#snapshots.clear();
        this.#changed.clear();
    }
}
