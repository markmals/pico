import type {
    ExtensionAPI,
    PreparedExtension,
    ToolCallEvent,
    ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import { resolvePath } from "@oh-my-pi/pi-coding-agent/extensibility/utils";
import { unwrapHashlineHeaderPath } from "@oh-my-pi/pi-coding-agent/tools/plan-mode-guard";
import fs from "node:fs/promises";

export interface RecordedWrite {
    /** Absolute path of the file the write replaced. */
    path: string;
    /** `null` when the file did not exist. */
    oldText: string | null;
    /** The file's content once the write finished, byte for byte. */
    newText: string;
}

/** The synthetic source Pico's own extension reports; it loads no file. */
const PICO_WRITE_RECORDER = "<pico:write-recorder>";

/** One file's content after a tool changed it, and when that change landed. */
interface Change {
    newText: string;
    at: number;
}

async function readText(absolutePath: string): Promise<string | null> {
    try {
        return await fs.readFile(absolutePath, "utf8");
    } catch {
        return null;
    }
}

/**
 * The file a `write` targets, or `undefined` when the target is not a
 * filesystem path (`local://…`). The hashline wrapper is unwrapped exactly as
 * the write tool unwraps it, so a model that pastes a `read` header as the
 * `path` argument is recorded against the file it actually wrote.
 */
function writeTarget(event: ToolCallEvent, cwd: string): string | undefined {
    if (!("path" in event.input)) return undefined;
    const target = event.input.path;
    if (typeof target !== "string") return undefined;
    try {
        return resolvePath(unwrapHashlineHeaderPath(target), cwd);
    } catch {
        return undefined;
    }
}

/** One file an edit touched, with the content it left behind when the result still carries it. */
function fileChange(value: unknown): { path: string; newText?: string } | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    if (!("path" in value) || typeof value.path !== "string") return undefined;
    if ("isError" in value && value.isError === true) return undefined;
    const newText =
        "newText" in value && typeof value.newText === "string" ? value.newText : undefined;
    return { path: value.path, newText };
}

/** Every file a successful `edit` rewrote. `newText` is absent when OMP pruned an oversized snapshot. */
function editedFiles(details: unknown): Array<{ path: string; newText?: string }> {
    if (typeof details !== "object" || details === null) return [];
    const edited: Array<{ path: string; newText?: string }> = [];
    if ("perFileResults" in details && Array.isArray(details.perFileResults)) {
        for (const result of details.perFileResults) {
            const changed = fileChange(result);
            if (changed) edited.push(changed);
        }
    }
    if (edited.length === 0) {
        const changed = fileChange(details);
        if (changed) edited.push(changed);
    }
    return edited;
}

/**
 * Records what each `write` replaced, through a Pico-owned extension rather
 * than a client bridge: a bridged write skips OMP's own write path, which is
 * what keeps a replaced file's CRLF line endings and byte order mark. The
 * `tool_call` hook runs before the tool, so it sees the old content; the
 * `tool_result` hook runs after it, so it sees the bytes on disk.
 */
export class WriteRecorder {
    readonly #cwd: string;
    readonly #snapshots = new Map<string, { path: string; oldText: string | null; at: number }>();
    readonly #changed = new Map<string, Change>();
    readonly #records = new Map<string, RecordedWrite>();
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
                pi.on("tool_result", event => this.#observe(event));
                pi.on("agent_end", () => this.#endTurn());
            },
        };
    }

    /** Consumes what the `write` with this tool call id replaced. */
    take(toolCallId: string): RecordedWrite | undefined {
        const record = this.#records.get(toolCallId);
        this.#records.delete(toolCallId);
        return record;
    }

    async #snapshot(event: ToolCallEvent): Promise<void> {
        if (event.toolName !== "write") return;
        const target = writeTarget(event, this.#cwd);
        if (target === undefined) return;
        const at = (this.#clock += 1);
        this.#snapshots.set(event.toolCallId, {
            path: target,
            oldText: await readText(target),
            at,
        });
    }

    async #observe(event: ToolResultEvent): Promise<void> {
        if (event.toolName === "edit") {
            if (!event.isError && "details" in event) await this.#noteEdit(event.details);
            return;
        }
        if (event.toolName === "write") await this.#record(event);
    }

    async #noteEdit(details: unknown): Promise<void> {
        for (const { path, newText } of editedFiles(details)) {
            // An oversized multi-file edit arrives without its snapshot, so read what it left on disk.
            const content = newText ?? (await readText(path));
            if (content === null) continue;
            this.#changed.set(path, { newText: content, at: (this.#clock += 1) });
            this.#forgetUnwatched(path);
        }
    }

    async #record(event: ToolResultEvent): Promise<void> {
        const snapshot = this.#snapshots.get(event.toolCallId);
        if (snapshot === undefined) return;
        this.#snapshots.delete(event.toolCallId);
        const newText = await readText(snapshot.path);
        if (newText === null) {
            this.#forgetUnwatched(snapshot.path);
            return;
        }
        // OMP prepares every tool call's arguments before it runs any of them, so
        // every write in a batch snapshots the same content. A write or edit that
        // finished after this one's snapshot is what this one actually replaced.
        // A file a `bash` command rewrote inside the same batch is invisible here:
        // nothing reports it, so the snapshot stands.
        const overtaken = this.#changed.get(snapshot.path);
        const oldText =
            overtaken && overtaken.at > snapshot.at ? overtaken.newText : snapshot.oldText;
        this.#changed.set(snapshot.path, { newText, at: (this.#clock += 1) });
        this.#records.set(event.toolCallId, { path: snapshot.path, oldText, newText });
        this.#forgetUnwatched(snapshot.path);
    }

    /** Prior content is only worth keeping while a write that might have been overtaken is still pending. */
    #forgetUnwatched(filePath: string): void {
        for (const snapshot of this.#snapshots.values()) {
            if (snapshot.path === filePath) return;
        }
        this.#changed.delete(filePath);
    }

    /** A call that never produced a result cannot be matched any more once the turn is over. */
    #endTurn(): void {
        this.#snapshots.clear();
        this.#changed.clear();
    }
}
