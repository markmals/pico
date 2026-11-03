import type { CommandInput, CommandSpec } from "./command.ts";
import type { CommandIo } from "./output.ts";

import { commandId } from "./command.ts";
import { CliError } from "./errors.ts";
import { writeError, writeResult } from "./output.ts";

export type CommandHandler = (input: CommandInput) => Promise<object>;

/**
 * Runs one command's handler and reports its exit status. The handler returns its result
 * without `apiVersion`, which the output contract adds.
 */
export async function executeCommand(
    command: CommandSpec,
    input: CommandInput,
    handler: CommandHandler,
    io: CommandIo,
): Promise<number> {
    try {
        writeResult(io, await handler(input));
        return 0;
    } catch (failure) {
        return writeError(io, asCliError(command, failure));
    }
}

function asCliError(command: CommandSpec, failure: unknown): CliError {
    if (failure instanceof CliError) return failure;
    const message = failure instanceof Error ? failure.message : String(failure);
    return new CliError("INTERNAL", message, { details: { command: commandId(command) } });
}
