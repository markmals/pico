// The entrypoint imports this before native extraction; keep the graph engine-free.

import type { CommandInput, CommandSpec } from "../command.ts";
import type { CommandIo } from "../output.ts";

import { describeLoginMethod } from "../../credentials/providers.ts";
import { commandId } from "../command.ts";
import { CliError } from "../errors.ts";
import { executeCommand } from "../execute.ts";
import { runtimeFreeCommand } from "./without-runtime.ts";

/** The commands whose preview must change nothing at all, including Pico's data directory. */
const PREVIEWABLE: Record<string, true | undefined> = {
    "providers update": true,
    "credentials create": true,
    "credentials delete": true,
    "auth login": true,
};

/**
 * Answers the invocations that need no runtime, and reports the exit status when it did.
 * `undefined` means the command genuinely needs Pico's engine, so the caller prepares the data
 * directory and the native addon and runs it normally.
 *
 * Previews, a login Pico cannot run, and a credential command on a platform without a Keychain
 * all answer here: each must leave the machine exactly as it found it.
 */
export async function runWithoutRuntime(
    command: CommandSpec,
    input: CommandInput,
    dataDir: string,
    stdout: WritableStream<Uint8Array>,
    stdoutIsTerminal: boolean,
): Promise<number | undefined> {
    const unsupported = input.options.dryRun === true ? undefined : platformRefusal(command);
    if (unsupported) return report(command, input, stdout, stdoutIsTerminal, () => unsupported);
    if (!answerable(command, input)) return undefined;
    return report(command, input, stdout, stdoutIsTerminal, () =>
        runtimeFreeCommand(commandId(command), input, dataDir),
    );
}

/** Whether this invocation is one the runtime-free path owns. */
function answerable(command: CommandSpec, input: CommandInput): boolean {
    const id = commandId(command);
    if (id === "providers list" || id === "providers get" || id === "credentials list") return true;
    if (id === "intellisense check") return true;
    if (PREVIEWABLE[id] === undefined) return false;
    if (id !== "auth login") return input.options.dryRun === true;
    const method = describeLoginMethod(input.arguments.method as string);
    return !method || !method.supported || input.options.dryRun === true;
}

/** A command the registry declares for macOS, running somewhere else. */
function platformRefusal(command: CommandSpec): CliError | undefined {
    if (command.platform === "any" || process.platform === "darwin") return undefined;
    return new CliError(
        "FAILED_PRECONDITION",
        `pico ${commandId(command)} stores credentials in the macOS login Keychain, which ${process.platform} does not have.`,
        { details: { platform: process.platform, required: command.platform } },
    );
}

/** Runs one answer through the ordinary output contract, so its envelope is the usual one. */
async function report(
    command: CommandSpec,
    input: CommandInput,
    stdout: WritableStream<Uint8Array>,
    stdoutIsTerminal: boolean,
    answer: () => Promise<object> | CliError,
): Promise<number> {
    const writer = stdout.getWriter();
    const writes: Promise<void>[] = [];
    const io: CommandIo = {
        stdout: text => writes.push(writer.write(new TextEncoder().encode(text))),
        stderr: text => process.stderr.write(text),
        stdoutIsTerminal,
    };
    const exitCode = await executeCommand(
        command,
        input,
        async () => {
            const result = answer();
            if (result instanceof CliError) throw result;
            return result;
        },
        io,
    );
    await Promise.all(writes);
    return exitCode;
}
