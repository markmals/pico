import { execFileSync } from "node:child_process";

/**
 * The process ids whose command line is exactly `command`.
 *
 * The whole line must match, so a shell that merely mentions the command — this smoke's own
 * `ps` call included — is not counted as the command running.
 */
export function runningPids(command: string): number[] {
    let listing = execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    let pids: number[] = [];

    for (let line of listing.split("\n")) {
        let entry = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (entry === null) continue;
        if (entry[2]?.trim() === command) pids.push(Number(entry[1]));
    }

    return pids;
}

/** Polls `settled` until it holds or `seconds` pass; reports whether it held. */
export async function waitUntil(seconds: number, settled: () => boolean): Promise<boolean> {
    let deadline = Date.now() + seconds * 1000;
    for (;;) {
        if (settled()) return true;
        if (Date.now() >= deadline) return false;
        await Bun.sleep(100);
    }
}

/** A subprocess's stdin as the writable stream `ndJsonStream` takes. */
export function subprocessInput(sink: Bun.FileSink): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
        async write(chunk) {
            sink.write(chunk);
            await sink.flush();
        },
        close() {
            sink.end();
        },
    });
}
