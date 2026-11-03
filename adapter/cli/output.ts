import type { CliError } from "./errors.ts";

import { errorDocument, exitCodeOf } from "./errors.ts";

export type CommandIo = {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    stdoutIsTerminal: boolean;
};

export function renderResult(result: object, pretty: boolean): string {
    return `${JSON.stringify({ apiVersion: 1, ...result }, undefined, pretty ? 2 : undefined)}\n`;
}

export function renderError(error: CliError): string {
    return `${JSON.stringify(errorDocument(error))}\n`;
}

export function writeResult(io: CommandIo, result: object): void {
    io.stdout(renderResult(result, io.stdoutIsTerminal));
}

/** Writes the error document as the last line of stderr and reports the exit status to use. */
export function writeError(io: CommandIo, error: CliError): number {
    io.stderr(renderError(error));
    return exitCodeOf(error.code);
}
