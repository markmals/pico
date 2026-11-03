import { describe, expect, test } from "bun:test";

import type { CommandInput } from "./command.ts";

import { findCommand } from "./command.ts";
import { CliError } from "./errors.ts";
import { executeCommand } from "./execute.ts";
import { settingsGetOutput } from "./result-schemas.ts";

function recorder() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        io: {
            stdout: (text: string) => void stdout.push(text),
            stderr: (text: string) => void stderr.push(text),
            stdoutIsTerminal: false,
        },
        get out() {
            return stdout.join("");
        },
        get err() {
            return stderr.join("");
        },
    };
}

const SETTINGS_GET = findCommand(["settings", "get"]) as never;
const MODELS_GET = findCommand(["models", "get"]) as never;
const EMPTY_INPUT: CommandInput = { arguments: {}, options: {} };

const SAVED_SETTINGS = {
    settingsFile: "/Users/mark/Library/Application Support/Pico/settings.json",
    status: "valid",
    revision: `sha256:${"b".repeat(64)}`,
    item: {
        defaultModel: "anthropic/claude-sonnet-5-5",
        defaultThinking: "high",
        autoBackground: null,
        providerCredentials: {},
    },
    effective: {
        defaultModel: "anthropic/claude-sonnet-5-5",
        defaultThinking: "high",
        source: "settings",
        available: true,
        autoBackground: true,
    },
};

describe("proposal.0007 running a command", () => {
    test("a handler's result reaches stdout with apiVersion, and the command succeeds", async () => {
        const recording = recorder();

        const exitCode = await executeCommand(
            SETTINGS_GET,
            EMPTY_INPUT,
            async () => SAVED_SETTINGS,
            recording.io,
        );

        expect(exitCode).toBe(0);
        expect(JSON.parse(recording.out)).toEqual({ apiVersion: 1, ...SAVED_SETTINGS });
        expect(recording.err).toBe("");
    });

    test("the printed document validates against the command's declared output schema", async () => {
        const recording = recorder();

        await executeCommand(SETTINGS_GET, EMPTY_INPUT, async () => SAVED_SETTINGS, recording.io);

        expect(settingsGetOutput.safeParse(JSON.parse(recording.out)).success).toBe(true);
    });

    test("the handler is given the parsed input", async () => {
        const recording = recorder();
        const input: CommandInput = {
            arguments: { model: "anthropic/claude-sonnet-5-5" },
            options: { dryRun: true },
        };
        let seen: CommandInput | undefined;

        await executeCommand(
            MODELS_GET,
            input,
            async given => {
                seen = given;
                return SAVED_SETTINGS;
            },
            recording.io,
        );

        expect(seen).toEqual(input);
    });

    test("a handler's CliError becomes its error document and exit status", async () => {
        const recording = recorder();

        const exitCode = await executeCommand(
            MODELS_GET,
            EMPTY_INPUT,
            async () => {
                throw new CliError("NOT_FOUND", "no model anthropic/nope", {
                    details: { model: "anthropic/nope" },
                });
            },
            recording.io,
        );

        expect(exitCode).toBe(1);
        expect(recording.out).toBe("");
        expect(JSON.parse(recording.err)).toEqual({
            apiVersion: 1,
            error: {
                code: "NOT_FOUND",
                message: "no model anthropic/nope",
                retryable: false,
                details: { model: "anthropic/nope" },
            },
        });
    });

    test("any other failure becomes INTERNAL with its message and the command that failed", async () => {
        const recording = recorder();

        const exitCode = await executeCommand(
            MODELS_GET,
            EMPTY_INPUT,
            async () => {
                throw new TypeError("models is not iterable");
            },
            recording.io,
        );

        expect(exitCode).toBe(1);
        expect(recording.out).toBe("");
        expect(JSON.parse(recording.err)).toEqual({
            apiVersion: 1,
            error: {
                code: "INTERNAL",
                message: "models is not iterable",
                retryable: false,
                details: { command: "models get" },
            },
        });
    });
});
