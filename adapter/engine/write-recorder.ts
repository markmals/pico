import type {
    ExtensionAPI,
    PreparedExtension,
    ToolCallEvent,
    ToolResultEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import { resolvePath } from "@oh-my-pi/pi-coding-agent/extensibility/utils";
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

async function readText(absolutePath: string): Promise<string | null> {
    try {
        return await fs.readFile(absolutePath, "utf8");
    } catch {
        return null;
    }
}

/** The file a `write` targets, or `undefined` when the target is not a filesystem path (`local://…`). */
function writeTarget(event: ToolCallEvent, cwd: string): string | undefined {
    if (!("path" in event.input)) return undefined;
    const target = event.input.path;
    if (typeof target !== "string") return undefined;
    try {
        return resolvePath(target, cwd);
    } catch {
        return undefined;
    }
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
    readonly #written = new Map<string, { newText: string; at: number }>();
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
                pi.on("tool_result", event => this.#record(event));
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

    async #record(event: ToolResultEvent): Promise<void> {
        const snapshot = this.#snapshots.get(event.toolCallId);
        if (snapshot === undefined) return;
        this.#snapshots.delete(event.toolCallId);
        const newText = await readText(snapshot.path);
        if (newText === null) return;
        // OMP prepares every tool call's arguments before it runs any of them, so
        // two writes to one path snapshot the same content. A write that finished
        // after this one's snapshot is what this one actually replaced.
        const overtaken = this.#written.get(snapshot.path);
        const oldText =
            overtaken && overtaken.at > snapshot.at ? overtaken.newText : snapshot.oldText;
        this.#written.set(snapshot.path, { newText, at: (this.#clock += 1) });
        this.#records.set(event.toolCallId, { path: snapshot.path, oldText, newText });
    }
}
