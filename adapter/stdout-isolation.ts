// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-mode.ts (MIT; see THIRD-PARTY-NOTICES.md).

import { Console } from "node:console";

/**
 * Hands stdout to the ACP stream alone.
 *
 * Every ordinary writer — Pico, OMP, an extension, a dependency — is redirected
 * to stderr, and the preserved file descriptor is returned for the protocol
 * stream. Call this before loading any module that could print, because a
 * single stray line on stdout corrupts the client's message stream.
 *
 * Writes that bypass the process object and the console, such as `fs.writeSync(1, …)`
 * or a child process that inherits this stdout, cannot be intercepted in process.
 */
export function isolateStdout(): WritableStream<Uint8Array> {
    const writeToStdout = process.stdout.write.bind(process.stdout);

    // Same call signature, different destination; the overload set is identical.
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    redirectConsole();

    return new WritableStream<Uint8Array>({
        write(chunk) {
            if (writeToStdout(chunk)) return undefined;
            const drained = Promise.withResolvers<void>();
            process.stdout.once("drain", () => drained.resolve());
            return drained.promise;
        },
    });
}

/**
 * Bun's console writes to the file descriptor directly rather than through
 * `process.stdout`, so redirecting the stream is not enough: the methods
 * themselves are replaced with ones bound to stderr. One console backs them all,
 * so group indentation, counters and timers stay consistent.
 */
function redirectConsole(): void {
    const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
    for (const method of Object.keys(stderrConsole)) {
        const implementation = Reflect.get(stderrConsole, method) as unknown;
        if (typeof implementation === "function") {
            Reflect.set(console, method, implementation.bind(stderrConsole));
        }
    }

    // Bun's console has two methods Node's does not, and its `Console.trace`
    // drops the message it was given.
    console.trace = (...args: unknown[]) =>
        stderrConsole.error("Trace:", ...args, `\n${callSite()}`);
    console.write = (...data: (string | ArrayBuffer | ArrayBufferView)[]) => {
        let written = 0;
        for (const chunk of data) {
            const bytes = toBuffer(chunk);
            process.stderr.write(bytes);
            written += bytes.byteLength;
        }
        return written;
    };
}

function toBuffer(chunk: string | ArrayBuffer | ArrayBufferView): Buffer {
    if (typeof chunk === "string") return Buffer.from(chunk);
    if (ArrayBuffer.isView(chunk))
        return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return Buffer.from(chunk);
}

function callSite(): string {
    const frames = new Error().stack?.split("\n") ?? [];
    return frames.slice(2).join("\n");
}
