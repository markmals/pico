import path from "node:path";

import type { CommandInput, CommandSpec } from "../command.ts";
import type { CommandHandler } from "../execute.ts";
import type { CommandIo } from "../output.ts";
import type { LoginIo } from "./auth-login.ts";
import type { HandledCommand, HandlerContext } from "./handlers.ts";

import { openCredentialVault } from "../../credentials/vault.ts";
import { describeCause } from "../../engine/errors.ts";
import { initializeRuntimeStorage } from "../../engine/runtime-storage.ts";
import { commandId } from "../command.ts";
import { CliError } from "../errors.ts";
import { executeCommand } from "../execute.ts";
import { readApiKey } from "../stdin.ts";
import { authLoginPreview, runAuthLogin } from "./auth-login.ts";
import { picoCatalog } from "./catalog.ts";
import { createCommandHandlers } from "./handlers.ts";

/**
 * Runs one command that needs Oh My Pi. `stdout` is the stream stdout isolation preserved, so
 * nothing Oh My Pi prints can reach the result; the exit status is returned once it is written.
 * Setup runs inside the command, so its failures end stderr with an error document too.
 *
 * This module is loaded only after the engine's native addon is in place, which is why it may
 * import the engine directly; `dispatch.ts` answers everything that comes before that.
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
    if (commandId(command) === "auth login") {
        if (input.options.dryRun === true) {
            // An undeclared method reaches here, where the engine can still identify it.
            const exitCode = await executeCommand(
                command,
                input,
                given => authLoginPreview(contextFor(dataDir), given),
                io,
            );
            await Promise.all(writes);
            return exitCode;
        }
        const loginIo: LoginIo = {
            // Awaited per line, so each event leaves the process before the next one is built.
            writeLine: text => writer.write(new TextEncoder().encode(text)),
            stderr: io.stderr,
        };
        return runAuthLogin(contextFor(dataDir), input, loginIo);
    }
    const handler: CommandHandler = async given => {
        const handlers = createCommandHandlers(contextFor(dataDir));
        return handlers[commandId(command) as HandledCommand](given);
    };
    const exitCode = await executeCommand(command, input, handler, io);
    await Promise.all(writes);
    return exitCode;
}

/** The commands' view of this machine: Pico's data directory, its catalog, its vault, stdin. */
function contextFor(dataDir: string): HandlerContext {
    return {
        dataDir,
        openCatalog: () => {
            runtimeStorage(dataDir);
            return picoCatalog(dataDir)();
        },
        openVault: options =>
            openCredentialVault({ dataDir, allowKeychainUI: options?.allowKeychainUI }),
        readStdin: () =>
            readApiKey({ isTerminal: process.stdin.isTTY === true, stream: Bun.stdin.stream() }),
    };
}

/** Points Oh My Pi's own storage at Pico's engine directory, reporting a failure as `IO_ERROR`. */
function runtimeStorage(dataDir: string): void {
    try {
        initializeRuntimeStorage(dataDir);
    } catch (error) {
        const engineDir = path.join(dataDir, "engine");
        const cause = describeCause(error);
        throw new CliError("IO_ERROR", `pico: cannot use ${engineDir}: ${cause}`, {
            details: { path: engineDir, cause },
        });
    }
}
