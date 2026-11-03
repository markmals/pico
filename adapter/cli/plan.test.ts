import { describe, expect, test } from "bun:test";

import type { Invocation } from "./plan.ts";

import { commandId } from "./command.ts";
import { rootHelp } from "./help.ts";
import { planInvocation } from "./plan.ts";
import { schemaIndexOutput, searchOutput } from "./result-schemas.ts";

function responded(invocation: Invocation): { exitCode: number; stdout: string; stderr: string } {
    if (invocation.kind !== "respond")
        throw new Error(`expected a response, got ${invocation.kind}`);
    return {
        exitCode: invocation.exitCode,
        stdout: invocation.stdout ?? "",
        stderr: invocation.stderr ?? "",
    };
}

function lastLine(text: string): string {
    const lines = text.trimEnd().split("\n");
    return lines[lines.length - 1] as string;
}

describe("proposal.0007 what one run of pico does", () => {
    test("no arguments with a piped stdin is the ACP agent Sesh launches", () => {
        expect(planInvocation([], false)).toEqual({ kind: "acp" });
    });

    test("exactly --version asks for the version", () => {
        expect(planInvocation(["--version"], false)).toEqual({ kind: "version" });
        expect(planInvocation(["--version"], true)).toEqual({ kind: "version" });
    });

    test("no arguments at a terminal prints the orientation and says Sesh launches pico", () => {
        const response = responded(planInvocation([], true));

        expect(response.exitCode).toBe(2);
        expect(response.stdout).toBe("");
        expect(response.stderr.startsWith(rootHelp())).toBe(true);
        expect(response.stderr).toContain("Sesh launches pico");
        expect(() => JSON.parse(lastLine(response.stderr))).toThrow();
    });

    test("--help prints the orientation to stdout and succeeds", () => {
        const response = responded(planInvocation(["--help"], true));

        expect(response).toEqual({ exitCode: 0, stdout: rootHelp(), stderr: "" });
    });

    test("--help after a command path prints that command's help", () => {
        const response = responded(planInvocation(["settings", "update", "--help"], false));

        expect(response.exitCode).toBe(0);
        expect(response.stdout).toContain("usage: pico settings update");
        expect(response.stderr).toBe("");
    });

    test("schema prints the index as one JSON document", () => {
        const response = responded(planInvocation(["schema"], false));

        expect(response.exitCode).toBe(0);
        expect(response.stdout.endsWith("\n")).toBe(true);
        expect(response.stdout.trimEnd().includes("\n")).toBe(false);
        expect(schemaIndexOutput.safeParse(JSON.parse(response.stdout)).success).toBe(true);
    });

    test("schema indents its document when stdout is a terminal", () => {
        const response = responded(planInvocation(["schema"], false, true));

        expect(response.stdout.startsWith('{\n  "apiVersion": 1,')).toBe(true);
    });

    test("schema with a command's words prints its specification", () => {
        const response = responded(planInvocation(["schema", "settings", "update"], false));

        expect(JSON.parse(response.stdout)).toMatchObject({
            apiVersion: 1,
            command: "settings update",
            effects: "writes",
        });
    });

    test("schema with an unknown command fails with NOT_FOUND", () => {
        const response = responded(planInvocation(["schema", "nope"], false));

        expect(response.exitCode).toBe(1);
        expect(response.stdout).toBe("");
        expect(JSON.parse(lastLine(response.stderr))).toMatchObject({
            apiVersion: 1,
            error: { code: "NOT_FOUND", retryable: false },
        });
    });

    test("cli search ranks the commands for a task", () => {
        const response = responded(
            planInvocation(["cli", "search", "change the default model"], false),
        );

        expect(response.exitCode).toBe(0);
        const result = JSON.parse(response.stdout) as { items: { command: string }[] };
        expect(searchOutput.safeParse(result).success).toBe(true);
        expect(result.items[0]?.command).toBe("settings update");
    });

    test("an unknown command exits 2 with an INVALID_ARGUMENT document", () => {
        const response = responded(planInvocation(["foo"], false));

        expect(response.exitCode).toBe(2);
        expect(response.stdout).toBe("");
        expect(JSON.parse(lastLine(response.stderr))).toMatchObject({
            apiVersion: 1,
            error: { code: "INVALID_ARGUMENT", retryable: false, details: { argument: "foo" } },
        });
    });

    test("--version with anything after it exits 2 with an INVALID_ARGUMENT document", () => {
        const response = responded(planInvocation(["--version", "extra"], false));

        expect(response.exitCode).toBe(2);
        expect(JSON.parse(lastLine(response.stderr))).toMatchObject({
            error: { code: "INVALID_ARGUMENT", details: { argument: "--version" } },
        });
    });

    test("a command backed by Oh My Pi is planned to run, with its input", () => {
        const invocation = planInvocation(
            ["settings", "update", "--default-model", "anthropic/claude-sonnet-5-5", "--dry-run"],
            false,
        );

        expect(invocation.kind).toBe("run");
        if (invocation.kind !== "run") return;
        expect(commandId(invocation.command)).toBe("settings update");
        expect(invocation.input).toEqual({
            arguments: {},
            options: { defaultModel: "anthropic/claude-sonnet-5-5", dryRun: true },
        });
    });

    test("a reading command is planned to run even at a terminal", () => {
        const invocation = planInvocation(["models", "list"], true);

        expect(invocation.kind).toBe("run");
        if (invocation.kind !== "run") return;
        expect(commandId(invocation.command)).toBe("models list");
    });
});
