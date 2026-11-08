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
    "providers list",
    "providers get",
    "providers update",
    "credentials list",
    "credentials get",
    "credentials create",
    "credentials delete",
    "auth login",
    "version get",
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
            "providers list": "reads",
            "providers get": "reads",
            "providers update": "writes",
            "credentials list": "reads",
            "credentials get": "reads",
            "credentials create": "writes",
            "credentials delete": "writes",
            "auth login": "writes",
            "version get": "none",
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

    test("every declared error explains when a caller sees it", () => {
        for (const command of COMMANDS) {
            for (const error of command.errors) {
                expect({
                    id: commandId(command),
                    code: error.code,
                    explained: error.when.length > 0,
                }).toEqual({ id: commandId(command), code: error.code, explained: true });
            }
        }
    });
});

describe("proposal.0009 what the registry declares about the credential commands", () => {
    test("only auth login streams, and it is the one command that does", () => {
        const streaming = COMMANDS.filter(command => command.outputMode === "json-lines");

        expect(streaming.map(commandId)).toEqual(["auth login"]);
    });

    test("the commands that reach Keychain declare the platform they need", () => {
        expect(COMMANDS.filter(command => command.platform === "macos").map(commandId)).toEqual([
            "credentials get",
            "credentials create",
            "credentials delete",
            "auth login",
        ]);
    });

    test("providers update takes exactly one of the two ways to change a binding", () => {
        expect(findCommand(["providers", "update"])?.constraints).toEqual([
            {
                kind: "exactly-one-of",
                options: ["--credential", "--disconnect"],
                description: "exactly one of --credential or --disconnect",
            },
        ]);
    });

    test("every mutating credential command previews, and the reading ones do not", () => {
        const previews = Object.fromEntries(
            COMMANDS.filter(command => commandId(command).startsWith("credentials ")).map(
                command => [commandId(command), command.dryRun],
            ),
        );

        expect(previews).toEqual({
            "credentials list": false,
            "credentials get": false,
            "credentials create": true,
            "credentials delete": true,
        });
    });

    test("the secret only ever arrives through stdin, never as an option's value", () => {
        const create = findCommand(["credentials", "create"]);

        expect(create?.options.map(option => option.name)).toEqual([
            "--provider",
            "--stdin",
            "--if-revision",
            "--allow-keychain-ui",
            "--dry-run",
        ]);
        expect(create?.options.find(option => option.name === "--stdin")?.type).toBe("boolean");
        expect(create?.arguments).toEqual([]);
    });

    test("the added error codes are declared by the commands that raise them", () => {
        const declared = new Set(
            COMMANDS.flatMap(command => command.errors.map(error => error.code as ErrorCode)),
        );

        for (const code of [
            "AUTH_REQUIRED",
            "KEYCHAIN_LOCKED",
            "KEYCHAIN_ACCESS_DENIED",
            "CANCELLED",
            "TIMED_OUT",
        ] as const) {
            expect({ code, declared: declared.has(code) }).toEqual({ code, declared: true });
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
