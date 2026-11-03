import { describe, expect, test } from "bun:test";

import type { ErrorCode } from "./errors.ts";

import { exitCodeOf } from "./errors.ts";
import { planInvocation } from "./plan.ts";

/** A 32-bit xorshift, deterministic per seed, as in the event-mapper property tests. */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

const TOKENS = [
    "schema",
    "cli",
    "search",
    "models",
    "list",
    "get",
    "settings",
    "update",
    "--provider",
    "--default-model",
    "--default-thinking",
    "--if-revision",
    "--dry-run",
    "--help",
    "--version",
    "--default-model=anthropic/claude-sonnet-5-5",
    "anthropic/claude-sonnet-5-5",
    "high",
    "none",
    `sha256:${"a".repeat(64)}`,
    "nope",
    "",
    "-",
    "--",
    "=x",
];

function randomArguments(next: (bound: number) => number): string[] {
    const length = next(6);
    return Array.from({ length }, () => TOKENS[next(TOKENS.length)] as string);
}

function lastLine(text: string): string {
    const lines = text.trimEnd().split("\n");
    return lines[lines.length - 1] as string;
}

type ErrorEnvelope = { apiVersion: number; error: { code: ErrorCode; retryable: boolean } };

describe("proposal.0007 invocation invariants", () => {
    test("for any arguments, planning never throws and a failure ends stderr with its error", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const next = randomSource(seed);
            for (const stdinIsTerminal of [false, true]) {
                const args = randomArguments(next);
                const invocation = planInvocation(args, stdinIsTerminal);
                if (invocation.kind !== "respond" || invocation.exitCode === 0) continue;
                if (args.length === 0) {
                    expect({ args, stdout: invocation.stdout }).toEqual({
                        args,
                        stdout: undefined,
                    });
                    continue;
                }

                const document = JSON.parse(lastLine(invocation.stderr ?? "")) as ErrorEnvelope;

                expect({ args, ...document, stdout: invocation.stdout }).toEqual({
                    args,
                    apiVersion: 1,
                    error: document.error,
                    stdout: undefined,
                });
                expect({ args, exitCode: invocation.exitCode }).toEqual({
                    args,
                    exitCode: exitCodeOf(document.error.code),
                });
            }
        }
    });

    test("for any arguments, a successful response prints one document or help on stdout", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const next = randomSource(seed);
            const args = randomArguments(next);
            const invocation = planInvocation(args, false);
            if (invocation.kind !== "respond" || invocation.exitCode !== 0) continue;

            const stdout = invocation.stdout ?? "";
            expect({ args, stderr: invocation.stderr }).toEqual({ args, stderr: undefined });
            expect({ args, ends: stdout.endsWith("\n") }).toEqual({ args, ends: true });
            if (args.includes("--help")) continue;
            // Compact output: exactly one line, and that line is one JSON document.
            expect({ args, lines: stdout.trimEnd().split("\n").length }).toEqual({
                args,
                lines: 1,
            });
            expect({ args, document: typeof JSON.parse(stdout) }).toEqual({
                args,
                document: "object",
            });
        }
    });

    test("for any arguments, only no arguments at all reaches the ACP agent", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const next = randomSource(seed);
            const args = randomArguments(next);
            const invocation = planInvocation(args, false);

            expect({ args, acp: invocation.kind === "acp" }).toEqual({
                args,
                acp: args.length === 0,
            });
        }
    });
});
