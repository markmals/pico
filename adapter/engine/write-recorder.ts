import type { ClientBridge } from "@oh-my-pi/pi-coding-agent/session/client-bridge";

import fs from "node:fs/promises";
import path from "node:path";

export interface RecordedWrite {
    /** `null` when the file did not exist. */
    oldText: string | null;
    newText: string;
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Routes every `write` through Pico so the old and new text are known before the
 * bytes land. The engine hands the bridge an absolute path and writes nothing
 * itself, which is the only place a `write` result exposes what it replaced.
 */
export class WriteRecorder {
    readonly #writes = new Map<string, RecordedWrite[]>();

    readonly bridge: ClientBridge = {
        capabilities: { writeTextFile: true },
        writeTextFile: async ({ path: absolutePath, content }) => {
            await this.#record(absolutePath, content);
        },
    };

    /** Consumes, in order, what was written to `absolutePath`. */
    take(absolutePath: string): RecordedWrite | undefined {
        return this.#writes.get(absolutePath)?.shift();
    }

    async #record(absolutePath: string, content: string): Promise<void> {
        let oldText: string | null = null;
        try {
            oldText = await fs.readFile(absolutePath, "utf8");
        } catch (error) {
            if (!isMissingFile(error)) throw error;
        }
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content);
        const recorded = this.#writes.get(absolutePath);
        if (recorded) recorded.push({ oldText, newText: content });
        else this.#writes.set(absolutePath, [{ oldText, newText: content }]);
    }
}
