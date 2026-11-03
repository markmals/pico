import { describe, expect, test } from "bun:test";

import { commandId, findCommand, usageOf } from "./command.ts";
import { commandHelp, rootHelp } from "./help.ts";
import { COMMANDS } from "./registry.ts";

describe("proposal.0007 command line help", () => {
    test("the orientation says that pico with no arguments is the agent Sesh launches", () => {
        const help = rootHelp();

        expect(help).toContain("ACP");
        expect(help).toContain("Sesh");
        expect(help).toMatch(/no arguments/);
    });

    test("the orientation lists every command with its summary", () => {
        const help = rootHelp();

        for (const command of COMMANDS) {
            expect({ id: commandId(command), listed: help.includes(commandId(command)) }).toEqual({
                id: commandId(command),
                listed: true,
            });
            expect({ id: commandId(command), summarized: help.includes(command.summary) }).toEqual({
                id: commandId(command),
                summarized: true,
            });
        }
    });

    test("the orientation says how to discover the rest", () => {
        const help = rootHelp();

        expect(help).toContain('pico cli search "<task>"');
        expect(help).toContain("pico schema <command>");
        expect(help).toContain("pico <command> --help");
        expect(help).toContain("--dry-run");
        expect(help).toContain("pico --version");
    });

    test("every command's help carries its usage, description, effects, errors and examples", () => {
        for (const command of COMMANDS) {
            const help = commandHelp(command);
            const missing = [
                usageOf(command),
                command.description,
                command.effects,
                ...command.errors.map(error => error.code),
                ...command.examples.map(example => example.command),
                ...command.examples.map(example => example.description),
            ].filter(piece => !help.includes(piece));

            expect({ id: commandId(command), missing }).toEqual({
                id: commandId(command),
                missing: [],
            });
        }
    });

    test("every argument and option appears with its type, default and accepted values", () => {
        const update = findCommand(["settings", "update"]) as never;
        const help = commandHelp(update);

        expect(help).toContain("--default-model <model>");
        expect(help).toContain("provider/id");
        expect(help).toContain("pico models list");
        expect(help).toContain("--dry-run");
        expect(help).toContain("default: false");
        expect(help).toContain("at least one of --default-model or --default-thinking");
    });

    test("a command's help says whether it supports a dry run", () => {
        expect(commandHelp(findCommand(["settings", "update"]) as never)).toContain(
            "Supports --dry-run",
        );
        expect(commandHelp(findCommand(["models", "list"]) as never)).not.toContain(
            "Supports --dry-run",
        );
    });

    test("an argument's help names what it accepts", () => {
        const help = commandHelp(findCommand(["models", "get"]) as never);

        expect(help).toContain("<model>");
        expect(help).toContain("required");
        expect(help).toContain("provider/id");
    });

    test("help ends with a newline and no trailing blank line", () => {
        for (const text of [rootHelp(), ...COMMANDS.map(command => commandHelp(command))]) {
            expect(text.endsWith("\n")).toBe(true);
            expect(text.endsWith("\n\n")).toBe(false);
        }
    });
});
