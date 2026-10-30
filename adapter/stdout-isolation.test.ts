import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "stdout-isolation.fixture.ts");

const NOISE = [
    "noise from console.log",
    "noise from console.info",
    "noise from console.debug",
    "noise written straight to stdout",
];

let stdout = "";
let stderr = "";
let exitCode = -1;

beforeAll(async () => {
    const fixture = Bun.spawn([process.execPath, FIXTURE], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    [stdout, stderr, exitCode] = await Promise.all([
        new Response(fixture.stdout).text(),
        new Response(fixture.stderr).text(),
        fixture.exited,
    ]);
});

describe("proposal.0001 stdout isolation", () => {
    test("the fixture runs to completion", () => {
        expect(exitCode).toBe(0);
    });

    test("stdout carries the protocol message and nothing else", () => {
        expect(stdout).toBe(
            `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } })}\n`,
        );
    });

    test.each(NOISE)("%s is diverted to stderr", line => {
        expect(stderr).toContain(line);
        expect(stdout).not.toContain(line);
    });
});
