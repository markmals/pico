import type { CommandInput, CommandSpec } from "./command.ts";

import { commandId } from "./command.ts";
import { CliError, exitCodeOf } from "./errors.ts";
import { commandHelp, rootHelp } from "./help.ts";
import { renderError, renderResult } from "./output.ts";
import { parseArguments } from "./parse.ts";
import { commandSpecification, schemaIndex } from "./schema.ts";
import { searchCommands } from "./search.ts";

export type Invocation =
    | { kind: "acp" }
    | { kind: "version" }
    | { kind: "respond"; exitCode: number; stdout?: string; stderr?: string }
    | { kind: "run"; command: CommandSpec; input: CommandInput };

const TERMINAL_HINT =
    "Sesh launches pico as an ACP agent over stdin and stdout. Register its path in Sesh as a custom agent instead of running it here.";

/**
 * What one run of `pico` does. Sesh launches it with no arguments and a piped stdin, so that
 * form, and only that form, is the ACP agent. Everything a command needs from Oh My Pi is
 * planned as `run`, so discovery can answer before any Oh My Pi module loads.
 */
export function planInvocation(
    args: readonly string[],
    stdinIsTerminal: boolean,
    stdoutIsTerminal = false,
): Invocation {
    if (args.length === 0) {
        if (!stdinIsTerminal) return { kind: "acp" };
        return { kind: "respond", exitCode: 2, stderr: `${rootHelp()}${TERMINAL_HINT}\n` };
    }
    if (args[0] === "--help") return { kind: "respond", exitCode: 0, stdout: rootHelp() };
    if (args[0] === "--version") {
        if (args.length === 1) return { kind: "version" };
        return failed(
            new CliError("INVALID_ARGUMENT", "pico --version takes no arguments", {
                details: { argument: "--version" },
            }),
        );
    }

    try {
        const parsed = parseArguments(args);
        if (parsed.kind === "help") {
            return { kind: "respond", exitCode: 0, stdout: commandHelp(parsed.command) };
        }
        const discovery = DISCOVERY[commandId(parsed.command)];
        if (!discovery) return { kind: "run", command: parsed.command, input: parsed.input };
        return {
            kind: "respond",
            exitCode: 0,
            stdout: renderResult(discovery(parsed.input), stdoutIsTerminal),
        };
    } catch (failure) {
        if (!(failure instanceof CliError)) throw failure;
        return failed(failure);
    }
}

const DISCOVERY: Record<string, ((input: CommandInput) => object) | undefined> = {
    schema: input => {
        // `cli search` shows a command as one string, so `schema "settings get"` names it too.
        const words = (input.arguments.command as readonly string[]).flatMap(argument =>
            argument.split(/\s+/).filter(word => word !== ""),
        );
        return words.length === 0 ? schemaIndex() : commandSpecification(words);
    },
    "cli search": input => searchCommands((input.arguments.query as readonly string[]).join(" ")),
};

function failed(error: CliError): Invocation {
    return {
        kind: "respond",
        exitCode: exitCodeOf(error.code),
        stderr: renderError(error),
    };
}
