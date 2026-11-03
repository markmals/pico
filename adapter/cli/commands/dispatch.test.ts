import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandInput, CommandSpec } from "../command.ts";

import { parseArguments } from "../parse.ts";
import { runWithoutRuntime } from "./dispatch.ts";

const REFERENCE = "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b";

const homes: string[] = [];

function dataDir(): string {
    const root = mkdtempSync(join(tmpdir(), "pico-dispatch-"));
    homes.push(root);
    return join(root, "Pico");
}

function parsed(args: readonly string[]): { command: CommandSpec; input: CommandInput } {
    const result = parseArguments(args);
    if (result.kind !== "command") throw new Error(`${args.join(" ")} did not parse as a command`);
    return result;
}

/** Runs the runtime-free path and collects what it wrote, as `pico` would. */
async function dispatch(args: readonly string[], directory: string) {
    const chunks: string[] = [];
    const stdout = new WritableStream<Uint8Array>({
        write(chunk) {
            chunks.push(new TextDecoder().decode(chunk));
        },
    });
    const { command, input } = parsed(args);
    const exitCode = await runWithoutRuntime(command, input, directory, stdout, false);
    return { exitCode, stdout: chunks.join("") };
}

function cleanup() {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
}

describe("proposal.0009 what Pico answers before it has a runtime", () => {
    test("a disconnection preview answers without creating Pico's data directory", async () => {
        const directory = dataDir();
        try {
            const result = await dispatch(
                ["providers", "update", "openai", "--disconnect", "--dry-run"],
                directory,
            );

            expect(result.exitCode).toBe(0);
            const receipt = JSON.parse(result.stdout);
            expect([receipt.dryRun, receipt.changed, receipt.apiVersion]).toEqual([true, false, 1]);
            expect(existsSync(directory)).toBe(false);
        } finally {
            cleanup();
        }
    });

    test("a deletion preview of a reference Pico never had is unchanged and creates nothing", async () => {
        const directory = dataDir();
        try {
            const result = await dispatch(
                ["credentials", "delete", REFERENCE, "--dry-run"],
                directory,
            );

            expect(result.exitCode).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({
                dryRun: true,
                changed: false,
                credential: null,
                keychain: "not-checked",
            });
            expect(existsSync(directory)).toBe(false);
        } finally {
            cleanup();
        }
    });

    test("a login Pico cannot run is refused before the stream starts", async () => {
        const directory = dataDir();
        try {
            const result = await dispatch(["auth", "login", "github-copilot"], directory);

            expect(result.exitCode).toBe(1);
            expect(result.stdout).toBe("");
            expect(existsSync(directory)).toBe(false);
        } finally {
            cleanup();
        }
    });

    test("nothing it answers leaves a file behind", async () => {
        const directory = dataDir();
        const parent = join(directory, "..");
        try {
            await dispatch(
                ["providers", "update", "openai", "--disconnect", "--dry-run"],
                directory,
            );
            await dispatch(["credentials", "delete", REFERENCE, "--dry-run"], directory);
            await dispatch(["auth", "login", "github-copilot"], directory);

            expect(readdirSync(parent)).toEqual([]);
        } finally {
            cleanup();
        }
    });
});
