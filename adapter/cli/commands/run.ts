import type { CommandInput, CommandSpec } from "../command.ts";
import type { CommandIo } from "../output.ts";
import type { HandledCommand } from "./handlers.ts";

import { initializeRuntimeStorage } from "../../engine/runtime-storage.ts";
import { commandId } from "../command.ts";
import { executeCommand } from "../execute.ts";
import { userCatalog } from "./catalog.ts";
import { createCommandHandlers } from "./handlers.ts";

/**
 * Runs one command that needs Oh My Pi. `stdout` is the stream stdout isolation preserved, so
 * nothing Oh My Pi prints can reach the result; the exit status is returned once it is written.
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
    const userAgentDir = initializeRuntimeStorage(dataDir);
    const handlers = createCommandHandlers({
        dataDir,
        openCatalog: userCatalog(userAgentDir, dataDir),
    });
    const handler = handlers[commandId(command) as HandledCommand];
    const exitCode = await executeCommand(command, input, handler, io);
    await Promise.all(writes);
    return exitCode;
}
