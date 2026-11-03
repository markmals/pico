import { describe, expect, test } from "bun:test";

import { CliError } from "./errors.ts";
import { MAX_SECRET_BYTES, readApiKey } from "./stdin.ts";

function piped(bytes: Uint8Array | string): { isTerminal: boolean; stream: ReadableStream } {
    const payload = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    return {
        isTerminal: false,
        stream: new ReadableStream({
            start(controller) {
                // Two chunks, so a reader that keeps only the first fails here.
                const half = Math.ceil(payload.length / 2);
                controller.enqueue(payload.subarray(0, half));
                if (half < payload.length) controller.enqueue(payload.subarray(half));
                controller.close();
            },
        }),
    };
}

async function refusal(input: Parameters<typeof readApiKey>[0]): Promise<CliError> {
    try {
        await readApiKey(input);
    } catch (error) {
        return error as CliError;
    }
    throw new Error("readApiKey resolved");
}

describe("proposal.0009 reading one API key from stdin", () => {
    test("the key is the input, with one trailing line ending removed", async () => {
        for (const ending of ["", "\n", "\r\n"]) {
            expect(await readApiKey(piped(`sk-FAKE-0009${ending}`))).toBe("sk-FAKE-0009");
        }
    });

    test("only one line ending goes, and inner whitespace is the key's own", async () => {
        expect(await readApiKey(piped("sk-FAKE-0009\n\n"))).toBe("sk-FAKE-0009\n");
        expect(await readApiKey(piped("  sk FAKE\t0009  "))).toBe("  sk FAKE\t0009  ");
        expect(await readApiKey(piped("sk-FAKE-0009\r"))).toBe("sk-FAKE-0009\r");
    });

    test("a key of exactly the cap is read, and one byte more is refused", async () => {
        const key = "k".repeat(MAX_SECRET_BYTES);

        expect((await readApiKey(piped(key))).length).toBe(MAX_SECRET_BYTES);

        const error = await refusal(piped(`${key}k`));
        expect([error.code, error.details]).toEqual([
            "INVALID_ARGUMENT",
            { argument: "--stdin", expected: `at most ${MAX_SECRET_BYTES} bytes` },
        ]);
        expect(error.message).not.toContain("k".repeat(32));
    });

    test("the cap counts the input, so a key at the cap plus its line ending is still read", async () => {
        const key = "k".repeat(MAX_SECRET_BYTES - 1);

        expect((await readApiKey(piped(`${key}\n`))).length).toBe(MAX_SECRET_BYTES - 1);
    });

    test("a terminal is refused, because a key must not be typed where it is seen", async () => {
        const error = await refusal({ isTerminal: true, stream: piped("sk-FAKE").stream });

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.message).toContain("terminal");
    });

    test("empty input, and input that is only a line ending, are refused", async () => {
        for (const raw of ["", "\n", "\r\n"]) {
            const error = await refusal(piped(raw));

            expect([raw, error.code]).toEqual([raw, "INVALID_ARGUMENT"]);
            expect(error.message).toContain("empty");
        }
    });

    test("a NUL byte is refused, so no truncated key is ever stored", async () => {
        const error = await refusal(piped("sk-FAKE\u0000-0009"));

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.message).toContain("NUL");
        expect(error.message).not.toContain("sk-FAKE");
    });

    test("bytes that are not UTF-8 are refused rather than replaced", async () => {
        const error = await refusal(piped(new Uint8Array([0x73, 0x6b, 0xff, 0xfe])));

        expect(error.code).toBe("INVALID_ARGUMENT");
        expect(error.message).toContain("UTF-8");
    });

    test("no refusal repeats the input it read", async () => {
        const secret = "sk-FAKE-0009-leak-canary";
        for (const raw of [`${secret}\u0000`, secret.repeat(4000)]) {
            const error = await refusal(piped(raw));

            expect(JSON.stringify(error.details) + error.message).not.toContain(secret);
        }
    });
});
