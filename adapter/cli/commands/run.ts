import path from "node:path";

import type { CommandInput, CommandSpec } from "../command.ts";
import type { CommandHandler } from "../execute.ts";
import type { CommandIo } from "../output.ts";
import type { HandledCommand } from "./handlers.ts";

import { describeCause } from "../../engine/errors.ts";
import { initializeRuntimeStorage } from "../../engine/runtime-storage.ts";
import { commandId } from "../command.ts";
import { CliError } from "../errors.ts";
import { executeCommand } from "../execute.ts";
import { userCatalog } from "./catalog.ts";
import { createCommandHandlers } from "./handlers.ts";

/**
 * Runs one command that needs Oh My Pi. `stdout` is the stream stdout isolation preserved, so
 * nothing Oh My Pi prints can reach the result; the exit status is returned once it is written.
 * Setup runs inside the command, so its failures end stderr with an error document too.
 */
export async function runCommand(
    command: CommandSpec,
    input: CommandInput,
    dataDir: string,
    stdout: WritableStream<Uint8Array>,
    stdoutIsTerminal: boolean,
): Promise<number> {
    const writer = stdout.getWriter();
    const writes: Promise<void>[] = [];
    const io: CommandIo = {
        stdout: text => writes.push(writer.write(new TextEncoder().encode(text))),
        stderr: text => process.stderr.write(text),
        stdoutIsTerminal,
    };
    const handler: CommandHandler = async given => {
        const userAgentDir = runtimeStorage(dataDir);
        const handlers = createCommandHandlers({
            dataDir,
            openCatalog: userCatalog(userAgentDir, dataDir),
        });
        return handlers[commandId(command) as HandledCommand](given);
    };
    const exitCode = await executeCommand(command, input, handler, io);
    await Promise.all(writes);
    return exitCode;
}

/** Points Oh My Pi's own storage at Pico's engine directory, reporting a failure as `IO_ERROR`. */
function runtimeStorage(dataDir: string): string {
    try {
        return initializeRuntimeStorage(dataDir);
    } catch (error) {
        const engineDir = path.join(dataDir, "engine");
        const cause = describeCause(error);
        throw new CliError("IO_ERROR", `pico: cannot use ${engineDir}: ${cause}`, {
            details: { path: engineDir, cause },
        });
    }
}
