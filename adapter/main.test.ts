import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dir, "main.ts");
/** The manifest `initialize` must report; the shape is this repository's own package.json. */
const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    version: string;
};
const PACKAGE_VERSION = manifest.version;

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            const newline = buffered.indexOf("\n");
            if (newline >= 0) return buffered.slice(0, newline);
        }
    } finally {
        reader.releaseLock();
    }
    throw new Error(`the agent sent no complete message; stdout was ${JSON.stringify(buffered)}`);
}

describe("proposal.0001 the stdio entry point", () => {
    test("answers initialize on stdout with the package version", async () => {
        const pico = Bun.spawn([process.execPath, ENTRY_POINT], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        pico.stdin.write(
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: 1, clientCapabilities: {} },
            })}\n`,
        );
        await pico.stdin.flush();

        const response = JSON.parse(await readLine(pico.stdout)) as {
            result?: { protocolVersion?: number; agentInfo?: { name?: string; version?: string } };
        };

        expect(response.result?.protocolVersion).toBe(1);
        expect(response.result?.agentInfo?.name).toBe("pico");
        expect(response.result?.agentInfo?.version).toBe(PACKAGE_VERSION);

        pico.stdin.end();
        expect(await pico.exited).toBe(0);
    }, 30_000);

    test("exits cleanly when its client disconnects without starting a session", async () => {
        const pico = Bun.spawn([process.execPath, ENTRY_POINT], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });

        pico.stdin.end();

        expect(await pico.exited).toBe(0);
    }, 30_000);
});
