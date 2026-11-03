import { describe, expect, test } from "bun:test";

import manifest from "../../package.json" with { type: "json" };
import { commandId, usageOf } from "./command.ts";
import { CliError } from "./errors.ts";
import { COMMANDS } from "./registry.ts";
import { commandSpecificationOutput, schemaIndexOutput } from "./result-schemas.ts";
import { commandSpecification, schemaIndex } from "./schema.ts";

describe("proposal.0007 schema command", () => {
    test("the index names pico's version and every command with its summary and effects", () => {
        const index = schemaIndex();

        expect(index).toEqual({
            apiVersion: 1,
            version: manifest.version,
            commands: COMMANDS.map(command => ({
                command: commandId(command),
                summary: command.summary,
                effects: command.effects,
            })),
        });
        expect(schemaIndexOutput.safeParse(index).success).toBe(true);
    });

    test("every command has a specification that validates against its declared shape", () => {
        for (const command of COMMANDS) {
            const specification = commandSpecification(command.path);
            const parsed = commandSpecificationOutput.safeParse(specification);

            expect({
                id: commandId(command),
                valid: parsed.success,
                issues: parsed.error?.issues,
            }).toEqual({
                id: commandId(command),
                valid: true,
                issues: undefined,
            });
        }
    });

    test("a specification carries the command's usage, effects, dry run and examples", () => {
        const specification = commandSpecification(["settings", "update"]);

        expect(specification.command).toBe("settings update");
        expect(specification.usage).toBe(usageOf(COMMANDS[5] as never));
        expect(specification.effects).toBe("writes");
        expect(specification.dryRun).toBe(true);
        expect(specification.idempotent).toBe(true);
        expect(specification.examples.length).toBeGreaterThan(0);
        expect(specification.options.map(option => option.name)).toEqual([
            "--default-model",
            "--default-thinking",
            "--auto-background",
            "--if-revision",
            "--dry-run",
        ]);
        expect(specification.options[4]).toEqual({
            name: "--dry-run",
            valueName: null,
            type: "boolean",
            required: false,
            default: false,
            format: null,
            accepted: null,
            description: "Do everything except write the file.",
        });
    });

    test("an argument carries what it accepts", () => {
        const specification = commandSpecification(["models", "get"]);

        expect(specification.arguments).toEqual([
            {
                name: "model",
                description: expect.any(String) as unknown as string,
                required: true,
                variadic: false,
                format: "provider/id, such as anthropic/claude-sonnet-5-5",
                accepted: null,
            },
        ]);
    });

    test("every specification's output is a JSON Schema object", () => {
        for (const command of COMMANDS) {
            const { output } = commandSpecification(command.path);

            expect({ id: commandId(command), schema: output.$schema }).toEqual({
                id: commandId(command),
                schema: "https://json-schema.org/draft/2020-12/schema",
            });
            expect(Object.keys(output).length).toBeGreaterThan(1);
        }
    });

    test("every declared error carries the exit status its code implies", () => {
        for (const command of COMMANDS) {
            for (const error of commandSpecification(command.path).errors) {
                // Only a mistake in the command line exits 2; retryability is the code's own
                // contract, checked where that contract lives rather than copied here.
                expect({
                    id: commandId(command),
                    code: error.code,
                    exitCode: error.exitCode,
                }).toEqual({
                    id: commandId(command),
                    code: error.code,
                    exitCode: error.code === "INVALID_ARGUMENT" ? 2 : 1,
                });
                expect(typeof error.retryable).toBe("boolean");
                expect(error.when.length).toBeGreaterThan(0);
            }
        }
    });

    test("an unknown command is not found, with the commands that exist", () => {
        try {
            commandSpecification(["nope"]);
            throw new Error("expected schema nope to be refused");
        } catch (error) {
            expect(error).toBeInstanceOf(CliError);
            if (!(error instanceof CliError)) return;
            expect(error.code).toBe("NOT_FOUND");
            expect(error.retryable).toBe(false);
            expect(error.details).toEqual({
                command: "nope",
                accepted: COMMANDS.map(command => commandId(command)),
            });
        }
    });
});

describe("proposal.0008 the auto-background option in schema output", () => {
    test("its specification carries its value name and the states it accepts", () => {
        const specification = commandSpecification(["settings", "update"]);

        expect(specification.options.find(option => option.name === "--auto-background")).toEqual({
            name: "--auto-background",
            valueName: "state",
            type: "string",
            required: false,
            default: null,
            format: "a value that is not empty",
            accepted: { values: ["on", "off"] },
            description: expect.any(String) as unknown as string,
        });
    });
});

describe("proposal.0009 what a credential command's schema tells a caller", () => {
    test("auth login declares that its success is a stream of documents", () => {
        const specification = commandSpecification(["auth", "login"]);

        expect([specification.outputMode, specification.platform]).toEqual(["json-lines", "macos"]);
    });

    test("an ordinary command declares one document and no platform of its own", () => {
        const specification = commandSpecification(["providers", "list"]);

        expect([specification.outputMode, specification.platform]).toEqual(["document", "any"]);
    });

    test("the login event shapes are published, so a caller can validate what it reads", () => {
        const output = commandSpecification(["auth", "login"]).output;

        expect(JSON.stringify(output)).toContain("authorization");
        expect(JSON.stringify(output)).toContain("completed");
    });

    test("the Keychain dialog is an option a caller opts into, never a default", () => {
        for (const path of [
            ["credentials", "get"],
            ["credentials", "create"],
            ["credentials", "delete"],
            ["providers", "update"],
            ["auth", "login"],
        ]) {
            const option = commandSpecification(path).options.find(
                declared => declared.name === "--allow-keychain-ui",
            );

            expect({ path, type: option?.type, default: option?.default }).toEqual({
                path,
                type: "boolean",
                default: false,
            });
        }
    });
});
