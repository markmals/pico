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
            "--if-revision",
            "--dry-run",
        ]);
        expect(specification.options[3]).toEqual({
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

    test("every declared error carries the exit status and retryability of its code", () => {
        for (const command of COMMANDS) {
            for (const error of commandSpecification(command.path).errors) {
                expect({ id: commandId(command), ...error, when: undefined }).toEqual({
                    id: commandId(command),
                    code: error.code,
                    exitCode: error.code === "INVALID_ARGUMENT" ? 2 : 1,
                    retryable: error.code === "CONFLICT",
                    when: undefined,
                });
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
