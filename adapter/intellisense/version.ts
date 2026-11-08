// Running the located `intellisense` once to prove Pico can use it (pico-bfk.20). Only
// `pico intellisense check` does this; attaching a session never runs the program.

import { EXECUTABLE_NAME } from "./location.ts";

/** How long `--version` may take before the check gives up on it. */
export const VERSION_TIMEOUT_MS = 5_000;

export type VersionResult = { version: string } | { problem: string };

const RAN = `\`${EXECUTABLE_NAME} --version\``;

/**
 * The first non-empty line `<executable> --version` prints, or why that run proves the
 * executable unusable: a non-zero exit, no output at all, or no answer in time.
 */
export async function readIntellisenseVersion(
    executable: string,
    timeoutMs: number,
): Promise<VersionResult> {
    let child;
    try {
        child = Bun.spawn([executable, "--version"], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
    } catch (error) {
        return { problem: `${RAN} could not be run: ${describe(error)}` };
    }
    const output = Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    // A program that leaves a grandchild holding the pipes keeps this read pending long after
    // the program itself is killed, so the deadline races the read instead of wrapping it.
    output.catch(() => undefined);
    const expiry = Promise.withResolvers<"timed out">();
    const deadline = setTimeout(() => expiry.resolve("timed out"), timeoutMs);
    const settled = await Promise.race([output, expiry.promise]);
    clearTimeout(deadline);
    if (settled === "timed out") {
        child.kill("SIGKILL");
        return { problem: `${RAN} did not finish within ${timeoutMs / 1000} seconds` };
    }
    const [exitCode, stdout, stderr] = settled;
    if (exitCode !== 0) {
        const detail = firstLine(stderr) ?? "it printed nothing on standard error";
        return { problem: `${RAN} exited ${exitCode}: ${detail}` };
    }
    const version = firstLine(stdout);
    return version === undefined ? { problem: `${RAN} printed no version` } : { version };
}

function firstLine(output: string): string | undefined {
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
