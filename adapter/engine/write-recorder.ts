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

/** What Pico knows about one tool call while it runs. */
interface PendingCall {
    /** The path argument as the call carried it, for detecting a redirect. */
    argument: string | undefined;
    snapshots: Snapshot[];
}

/** Why a redirected call has no diff. */
const REDIRECTED = "an extension changed which file the call wrote";

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
 * The file a path really names, resolved one component at a time so the answer
 * is the same before and after the file exists. `fs.realpath` cannot do this: it
 * fails on a path whose last components are not there yet, and the fallback of
 * resolving only the parent misses a symlinked directory further up — so a file
 * created under new directories, or reached through a dangling directory link,
 * would key differently once it exists.
 */
async function realPath(absolutePath: string): Promise<string> {
    const { root } = path.parse(absolutePath);
    let resolved = root;
    let remaining = absolutePath.slice(root.length).split(path.sep).filter(Boolean);
    let hops = 0;
    while (remaining.length > 0) {
        const segment = remaining.shift();
        if (segment === undefined || segment === ".") continue;
        if (segment === "..") {
            resolved = path.dirname(resolved);
            continue;
        }
        const candidate = path.join(resolved, segment);
        const link = hops < MAX_SYMLINK_HOPS ? await readLink(candidate) : undefined;
        if (link === undefined) {
            resolved = candidate;
            continue;
        }
        hops += 1;
        // Re-walk from the link's target: its own components may be links too.
        const target = path.isAbsolute(link) ? link : path.join(resolved, link);
        remaining = [...target.slice(root.length).split(path.sep).filter(Boolean), ...remaining];
        resolved = root;
    }
    return resolved;
}

/** Where a path points when it is a symlink, or `undefined` when it is anything else. */
async function readLink(candidate: string): Promise<string | undefined> {
    try {
        if (!(await fs.lstat(candidate)).isSymbolicLink()) return undefined;
        return await fs.readlink(candidate);
    } catch {
        return undefined;
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
 * The path argument the call carries, as the user's model wrote it. Comparing
 * it before and after execution is how a redirect by an extension is detected:
 * canonical paths cannot be compared, because a path only becomes resolvable
 * once the call has created it.
 */
function pathArgument(event: ToolCallEvent | ToolResultEvent): string | undefined {
    if (event.toolName === "write") {
        if (!("path" in event.input)) return undefined;
        const target = event.input.path;
        return typeof target === "string" ? unwrapHashlineHeaderPath(target) : undefined;
    }
    if (event.toolName !== "edit") return undefined;
    if (!("input" in event.input)) return undefined;
    const input = event.input.input;
    return typeof input === "string" ? input : undefined;
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
    readonly #calls = new Map<string, PendingCall>();
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
        if (event.toolName !== "write" && event.toolName !== "edit") return;
        const snapshots: Snapshot[] = [];
        for (const file of targets(event, this.#cwd)) {
            snapshots.push({
                path: file,
                key: await realPath(file),
                before: await readState(file),
                at: (this.#clock += 1),
            });
        }
        // Kept even with no targets: a call that named an internal URL may still
        // be redirected onto a project file, and that has to be reported.
        this.#calls.set(event.toolCallId, { argument: pathArgument(event), snapshots });
    }

    async #record(event: ToolResultEvent): Promise<void> {
        const call = this.#calls.get(event.toolCallId);
        if (call === undefined) return;
        this.#calls.delete(event.toolCallId);
        // An extension's `tool_call` hook may have redirected the call. Oh My Pi
        // hands every hook the same original input and only aggregates the
        // revisions afterwards, so the rewritten argument is first visible here.
        const redirected = pathArgument(event) !== call.argument;
        const records: RecordedChange[] = [];
        if (!event.isError) {
            if (redirected) records.push(...(await this.#redirected(event)));
            else {
                for (const snapshot of call.snapshots) {
                    const change = await this.#changeOf(snapshot);
                    if (change) records.push(change);
                }
            }
        }
        for (const snapshot of call.snapshots) this.#forgetUnwatched(snapshot.key);
        if (records.length > 0) this.#records.set(event.toolCallId, records);
    }

    /**
     * A call an extension pointed at another file: Pico never saw that file
     * before it ran, so it names the file and says why there is no diff. An
     * internal URL is not a project file and gets no record at all.
     */
    async #redirected(event: ToolResultEvent): Promise<RecordedChange[]> {
        const records: RecordedChange[] = [];
        for (const file of targets(event, this.#cwd)) {
            const key = await realPath(file);
            this.#changed.set(key, { after: await readState(file), at: (this.#clock += 1) });
            this.#forgetUnwatched(key);
            records.push({ path: file, noDiff: REDIRECTED });
        }
        return records;
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
        for (const call of this.#calls.values()) {
            if (call.snapshots.some(snapshot => snapshot.key === key)) return;
        }
        this.#changed.delete(key);
    }

    /** A call that never produced a result cannot be matched any more once the turn is over. */
    #endTurn(): void {
        this.#calls.clear();
        this.#changed.clear();
    }
}
