import { describe, expect, test } from "bun:test";

import type { ErrorCode } from "./errors.ts";

import { commandId, findCommand, usageOf } from "./command.ts";
import { COMMANDS } from "./registry.ts";

const DECLARED = [
    "schema",
    "cli search",
    "models list",
    "models get",
    "settings get",
    "settings update",
];

describe("proposal.0007 command registry", () => {
    test("the registry declares every command of the proposal's command tree, in order", () => {
        expect(COMMANDS.map(command => commandId(command))).toEqual(DECLARED);
    });

    test("every command carries the text, effects and examples the registry is read for", () => {
        for (const command of COMMANDS) {
            const id = commandId(command);

            expect({
                id,
                summary: command.summary.length > 0,
                description: command.description.length > 0,
                keywords: command.keywords.length > 0,
                effects: ["none", "reads", "writes"].includes(command.effects),
                errors: command.errors.length > 0,
                examples: command.examples.length > 0,
            }).toEqual({
                id,
                summary: true,
                description: true,
                keywords: true,
                effects: true,
                errors: true,
                examples: true,
            });
        }
    });

    test("every example is a full pico command line for its own command", () => {
        for (const command of COMMANDS) {
            for (const example of command.examples) {
                expect({ id: commandId(command), command: example.command }).toEqual({
                    id: commandId(command),
                    command: expect.stringMatching(/^pico /) as unknown as string,
                });
                expect(example.description.length).toBeGreaterThan(0);
            }
        }
    });

    test("the discovery commands read nothing and the settings and models commands do", () => {
        expect(
            Object.fromEntries(COMMANDS.map(command => [commandId(command), command.effects])),
        ).toEqual({
            schema: "none",
            "cli search": "none",
            "models list": "reads",
            "models get": "reads",
            "settings get": "reads",
            "settings update": "writes",
        });
    });

    test("settings update declares its options, its dry run and its one constraint", () => {
        const update = findCommand(["settings", "update"]);

        expect(update?.options.map(option => option.name)).toEqual([
            "--default-model",
            "--default-thinking",
            "--auto-background",
            "--if-revision",
            "--dry-run",
        ]);
        expect(update?.dryRun).toBe(true);
        expect(update?.idempotent).toBe(true);
        expect(update?.constraints).toEqual([
            {
                kind: "at-least-one-of",
                options: ["--default-model", "--default-thinking", "--auto-background"],
                description:
                    "at least one of --default-model, --default-thinking or --auto-background",
            },
        ]);
    });

    test("models get takes the model as its one required argument", () => {
        const get = findCommand(["models", "get"]);

        expect(get?.arguments).toEqual([
            {
                name: "model",
                description: expect.any(String) as unknown as string,
                required: true,
                variadic: false,
                format: "model",
            },
        ]);
        expect(get?.options).toEqual([]);
    });

    test("the usage line shows a command's arguments and options", () => {
        expect(usageOf(findCommand(["models", "get"]) as never)).toBe("pico models get <model>");
        expect(usageOf(findCommand(["models", "list"]) as never)).toBe(
            "pico models list [--provider <provider>]",
        );
        expect(usageOf(findCommand(["settings", "update"]) as never)).toBe(
            "pico settings update [--default-model <model>] [--default-thinking <level>]" +
                " [--auto-background <state>] [--if-revision <revision>] [--dry-run]",
        );
        expect(usageOf(findCommand(["cli", "search"]) as never)).toBe("pico cli search <query…>");
        expect(usageOf(findCommand(["schema"]) as never)).toBe("pico schema [<command…>]");
    });

    test("a command is found by its path words and nothing else", () => {
        expect(commandId(findCommand(["settings", "update"]) as never)).toBe("settings update");
        expect(findCommand(["settings"])).toBeUndefined();
        expect(findCommand(["settings", "update", "extra"])).toBeUndefined();
        expect(findCommand(["nope"])).toBeUndefined();
    });

    test("every declared error code is one the output contract defines", () => {
        const codes: ErrorCode[] = [
            "INVALID_ARGUMENT",
            "NOT_FOUND",
            "FAILED_PRECONDITION",
            "CONFLICT",
            "UNAVAILABLE",
            "IO_ERROR",
            "INTERNAL",
        ];

        for (const command of COMMANDS) {
            for (const error of command.errors) {
                expect({
                    id: commandId(command),
                    known: codes.includes(error.code),
                    explained: error.when.length > 0,
                }).toEqual({ id: commandId(command), known: true, explained: true });
            }
        }
    });
});

describe("proposal.0008 the auto-background option", () => {
    test("settings update declares it with its value name and the states it accepts", () => {
        const option = findCommand(["settings", "update"])?.options.find(
            declared => declared.name === "--auto-background",
        );

        expect(option).toEqual({
            name: "--auto-background",
            valueName: "state",
            type: "string",
            format: "text",
            required: false,
            default: undefined,
            accepted: { kind: "values", values: ["on", "off"] },
            description: expect.any(String) as unknown as string,
        });
    });

    test("its words are in the command's search keywords", () => {
        const keywords = findCommand(["settings", "update"])?.keywords ?? [];

        expect(["background", "bash", "job"].filter(word => !keywords.includes(word))).toEqual([]);
    });

    test("an example turns it off", () => {
        const examples = findCommand(["settings", "update"])?.examples ?? [];

        expect(
            examples.some(
                example => example.command === "pico settings update --auto-background off",
            ),
        ).toBe(true);
    });

    test("the INVALID_ARGUMENT description names it among the options one of which is required", () => {
        const invalid = findCommand(["settings", "update"])?.errors.find(
            error => error.code === "INVALID_ARGUMENT",
        );

        expect(invalid?.when).toContain("--auto-background");
    });
});
