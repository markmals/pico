import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dir, "main.ts");
/** The manifest `initialize` must report; the shape is this repository's own package.json. */
const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    version: string;
};
const PACKAGE_VERSION = manifest.version;

const homes: string[] = [];

/** A scratch home, so nothing here touches the real `~/Library/Application Support/Pico`. */
function scratchHome(): string {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "pico-home-")));
    homes.push(home);
    return home;
}

afterEach(() => {
    for (const home of homes.splice(0)) {
        chmodSync(home, 0o755);
        rmSync(home, { recursive: true, force: true });
    }
});

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
    function spawnPico(home = scratchHome()): Bun.Subprocess<"pipe", "pipe", "pipe"> {
        return Bun.spawn([process.execPath, ENTRY_POINT], {
            env: { ...process.env, HOME: home },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
    }

    async function initialize(pico: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<{
        result?: { protocolVersion?: number; agentInfo?: { name?: string; version?: string } };
    }> {
        pico.stdin.write(
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: 1, clientCapabilities: {} },
            })}\n`,
        );
        await pico.stdin.flush();
        return JSON.parse(await readLine(pico.stdout)) as {
            result?: { protocolVersion?: number; agentInfo?: { name?: string; version?: string } };
        };
    }

    test("answers initialize on stdout with the package version", async () => {
        const pico = spawnPico();

        const response = await initialize(pico);

        expect(response.result?.protocolVersion).toBe(1);
        expect(response.result?.agentInfo?.name).toBe("pico");
        expect(response.result?.agentInfo?.version).toBe(PACKAGE_VERSION);

        pico.stdin.end();
        expect(await pico.exited).toBe(0);
    }, 30_000);

    test.each(["SIGTERM", "SIGINT"] as const)(
        "shuts down cleanly on %s",
        async signal => {
            const pico = spawnPico();
            await initialize(pico);

            pico.kill(signal);

            expect(await pico.exited).toBe(0);
        },
        30_000,
    );

    test("exits cleanly when its client disconnects without starting a session", async () => {
        const pico = spawnPico();

        pico.stdin.end();

        expect(await pico.exited).toBe(0);
    }, 30_000);

    test("proposal.0002 a data directory that cannot be created stops the agent before any ACP message", async () => {
        const home = scratchHome();
        mkdirSync(join(home, "Library"));
        chmodSync(join(home, "Library"), 0o555);
        const pico = spawnPico(home);
        pico.stdin.end();

        const [exitCode, stdout, stderr] = await Promise.all([
            pico.exited,
            new Response(pico.stdout).text(),
            new Response(pico.stderr).text(),
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toStartWith(
            `pico: cannot use ${join(home, "Library", "Application Support", "Pico")}: `,
        );
        chmodSync(join(home, "Library"), 0o755);
    }, 30_000);

    test("proposal.0002 a model cache Pico cannot write stops the agent before any ACP message", async () => {
        const home = scratchHome();
        const cache = join(home, "Library", "Application Support", "Pico", "models.db");
        mkdirSync(cache, { recursive: true });
        const pico = spawnPico(home);
        pico.stdin.end();

        const [exitCode, stdout, stderr] = await Promise.all([
            pico.exited,
            new Response(pico.stdout).text(),
            new Response(pico.stderr).text(),
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toStartWith(`pico: cannot use ${cache}: `);
    }, 30_000);
});
