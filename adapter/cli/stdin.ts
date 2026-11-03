import { CliError } from "./errors.ts";

/** The most key material `credentials create --stdin` reads; a longer input is refused whole. */
export const MAX_SECRET_BYTES = 64 * 1024;

/** Where a secret arrives: stdin in production, a scripted stream in a test. */
export interface SecretInput {
    isTerminal: boolean;
    stream: ReadableStream<Uint8Array>;
}

/**
 * One API key, read privately. The key is the input with at most one trailing line ending
 * removed, so a key whose own characters include spaces survives. Every refusal describes the
 * rule it broke and never repeats what it read.
 */
export async function readApiKey(input: SecretInput): Promise<string> {
    if (input.isTerminal) {
        throw refused(
            "pico credentials create reads the key from a pipe or a file, not from a terminal.",
        );
    }
    const key = withoutLineEnding(decoded(await readCapped(input.stream)));
    if (key.includes("\u0000")) {
        throw refused("The key holds a NUL character, so it is not one line of key material.");
    }
    if (key.length === 0) throw refused("The key is empty.");
    return key;
}

/** Reads the stream, stopping as soon as it is longer than a key may be. */
async function readCapped(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = stream.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_SECRET_BYTES) {
                throw refused(`The key is longer than ${MAX_SECRET_BYTES} bytes.`, {
                    expected: `at most ${MAX_SECRET_BYTES} bytes`,
                });
            }
            chunks.push(value);
        }
    } finally {
        // The source is dropped either way; a refusal must not leave it pumping bytes.
        reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

function decoded(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw refused("The key is not UTF-8 text.");
    }
}

function withoutLineEnding(raw: string): string {
    if (raw.endsWith("\r\n")) return raw.slice(0, -2);
    if (raw.endsWith("\n")) return raw.slice(0, -1);
    return raw;
}

function refused(message: string, details: Record<string, unknown> = {}): CliError {
    return new CliError("INVALID_ARGUMENT", message, {
        details: { argument: "--stdin", ...details },
    });
}
