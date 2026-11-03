import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];
const entry = join(import.meta.dir, "pico.ts");
const fakeKey = "FAKE-pico-0008-not-a-provider-credential";

function home(): string {
    const directory = mkdtempSync(join(tmpdir(), "pico-credential-cli-"));
    homes.push(directory);
    chmodSync(directory, 0o555);
    return directory;
}

async function run(args: string[], directory: string, stdin = "") {
    const child = Bun.spawn([process.execPath, entry, ...args], {
        env: { HOME: directory, PATH: "/usr/bin:/bin" },
        stdin: new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
}

afterEach(() => {
    for (const directory of homes.splice(0)) {
        chmodSync(directory, 0o700);
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("proposal.0009 credential command boundaries", () => {
    test("API-key preview neither persists the key nor creates a writable runtime", async () => {
        const directory = home();
        const result = await run(
            ["credentials", "create", "--provider", "openai", "--stdin", "--dry-run"],
            directory,
            `${fakeKey}\n`,
        );
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).dryRun).toBe(true);
        expect(result.stdout).not.toContain(fakeKey);
        expect(result.stderr).toBe("");
        expect(readdirSync(directory)).toEqual([]);
    }, 30_000);

    test("disconnect preview succeeds for an unconfigured provider without creating settings", async () => {
        const directory = home();
        const result = await run(
            ["providers", "update", "openai", "--disconnect", "--dry-run"],
            directory,
        );
        expect(result.exitCode).toBe(0);
        const receipt = JSON.parse(result.stdout);
        expect(receipt.dryRun).toBe(true);
        expect(receipt.changed).toBe(false);
        expect(result.stderr).toBe("");
        expect(readdirSync(directory)).toEqual([]);
    }, 30_000);

    test("a known prompt-dependent login refuses before starting a flow", async () => {
        const directory = home();
        const result = await run(["auth", "login", "github-copilot"], directory);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        const failure = JSON.parse(result.stderr.trimEnd().split("\n").at(-1)!);
        expect(failure.error.code).toBe("FAILED_PRECONDITION");
        expect(readdirSync(directory)).toEqual([]);
    }, 30_000);
});

test("proposal.0009 an unknown login preview is refused without creating a runtime", async () => {
    const directory = home();
    const result = await run(["auth", "login", "not-a-method", "--dry-run"], directory);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const failure = JSON.parse(result.stderr.trimEnd().split("\n").at(-1)!);
    expect(failure.error.code).toBe("NOT_FOUND");
    expect(readdirSync(directory)).toEqual([]);
}, 30_000);

test("proposal.0009 absent credential metadata is readable without creating a runtime", async () => {
    const directory = home();
    const result = await run(["credentials", "list"], directory);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).items).toEqual([]);
    expect(result.stderr).toBe("");
    expect(readdirSync(directory)).toEqual([]);
}, 30_000);
