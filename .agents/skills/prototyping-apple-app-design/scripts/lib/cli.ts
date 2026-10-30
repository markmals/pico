/**
 * Shared CLI plumbing for this skill's scripts.
 *
 * These scripts replaced bash, where `exit 64` from any depth was one word. `ExitError`
 * keeps that convenience without calling `process.exit()`, which can truncate stdout
 * when the output is being piped.
 */

import process from "node:process";

export type OptionConfig = {
    readonly type: "string" | "boolean";
    readonly multiple?: boolean;
};

export class ExitError extends Error {
    readonly code: number;

    constructor(code: number) {
        super(`exit ${code}`);
        this.name = "ExitError";
        this.code = code;
    }
}

/** Write `lines` to stderr, then unwind to `runMain`, which sets the exit status. */
export function die(code: number, ...lines: string[]): never {
    for (const line of lines) {
        process.stderr.write(`${line}\n`);
    }
    throw new ExitError(code);
}

export async function runMain(main: () => void | Promise<void>): Promise<void> {
    try {
        await main();
    } catch (error) {
        if (error instanceof ExitError) {
            process.exitCode = error.code;
            return;
        }
        throw error;
    }
}

/**
 * The first token the shell scripts' `*)` branch would have rejected.
 *
 * `parseArgs` reports unknown options in its own wording; recovering the token here
 * keeps the `unknown option: --foo` line — and its exit 64 — identical to the bash
 * these scripts replaced.
 */
export function offendingToken(
    args: readonly string[],
    options: Readonly<Record<string, OptionConfig>>,
    allowPositionals: boolean,
): string {
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index] ?? "";
        if (!token.startsWith("-") || token === "-") {
            if (allowPositionals) {
                continue;
            }
            return token;
        }
        if (!token.startsWith("--")) {
            return token;
        }
        const equals = token.indexOf("=");
        const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
        const option = options[name];
        if (option === undefined) {
            return token;
        }
        // A declared string option swallows the next token as its value; skipping it
        // keeps `--app reminders` from being mistaken for a stray positional.
        if (option.type === "string" && equals === -1) {
            index += 1;
        }
    }
    return args[0] ?? "";
}

/** Translate a `parseArgs` failure into the shell scripts' usage error. */
export function rejectArgs(
    error: unknown,
    args: readonly string[],
    options: Readonly<Record<string, OptionConfig>>,
    allowPositionals: boolean,
): never {
    if (error instanceof ExitError) {
        throw error;
    }
    // `--out` with nothing after it. Bash died on `set -u` here and said nothing useful;
    // parseArgs names the option, which is worth keeping.
    if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE"
    ) {
        die(64, `error: ${error.message}`);
    }
    die(64, `unknown option: ${offendingToken(args, options, allowPositionals)}`);
}

/** Bash's `$(cat file)`, which strips trailing newlines but keeps other whitespace. */
export function stripTrailingNewlines(value: string): string {
    return value.replace(/\n+$/, "");
}

export function sleep(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
}
