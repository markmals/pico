import type { LoginEvent } from "../../credentials/login.ts";
import type { CommandInput } from "../command.ts";
import type { HandlerContext } from "./handlers.ts";

import {
    LoginError,
    LOGIN_DEADLINE_MS,
    resolveLoginMethod,
    runLogin,
} from "../../credentials/login.ts";
import { describeLoginMethod } from "../../credentials/providers.ts";
import { CliError, errorDocument, exitCodeOf } from "../errors.ts";
import { projectCredential, selectCommand, asCliError, withVault } from "./credentials.ts";

/** Where one attempt's events go: a line at a time, flushed before the next one is built. */
export interface LoginIo {
    writeLine(text: string): Promise<void>;
    stderr(text: string): void;
}

interface LoginOptions {
    allowKeychainUi?: boolean;
    dryRun?: boolean;
}

/** The attempt `--dry-run` describes: what Pico would run, with nothing authorized. */
export async function authLoginPreview(
    context: HandlerContext,
    given: CommandInput,
): Promise<object> {
    const method = supportedMethod(given.arguments.method as string);
    return withVault(context, {}, vault => ({
        dryRun: true as const,
        method: method.method,
        provider: method.provider,
        interaction: method.interaction,
        localBrowser: method.localBrowser,
        deadlineSeconds: Math.round(LOGIN_DEADLINE_MS / 1000),
        revision: vault.revision(),
        keychain: "not-checked" as const,
    }));
}

/**
 * Runs one login, writing an event per line and reporting the exit status. A failure still ends
 * stderr with the error document, after the events already written to stdout: this command is
 * the one place where stdout is not empty on failure.
 */
export async function runAuthLogin(
    context: HandlerContext,
    given: CommandInput,
    io: LoginIo,
): Promise<number> {
    const options = given.options as LoginOptions;
    const attempt = new AbortController();
    const release = stopOn(attempt);
    let attemptId: string | undefined;
    let sequence = 0;
    try {
        await withVault(
            context,
            { allowKeychainUI: options.allowKeychainUi === true },
            async vault => {
                const id = given.arguments.method as string;
                const method = supportedMethod(id, await resolveLoginMethod(id));
                const pending: Promise<void>[] = [];
                let writeFailure: unknown;
                await runLogin({
                    method: method.method,
                    vault,
                    signal: attempt.signal,
                    emit: event => {
                        attemptId = event.attemptId;
                        sequence = event.sequence + 1;
                        pending.push(
                            write(io, attempt, projectEvent(event)).catch(error => {
                                writeFailure ??= error;
                            }),
                        );
                    },
                });
                // A completion the caller never sees is still stored; the pipe must not hide it.
                await Promise.all(pending);
                if (writeFailure !== undefined) throw writeFailure;
            },
        );
        return 0;
    } catch (failure) {
        const error = asLoginCliError(failure);
        // A refusal before the attempt started leaves stdout empty, as every other command does.
        if (attemptId !== undefined) {
            await write(io, attempt, {
                type: "failed",
                attemptId,
                sequence,
                error: errorDocument(error).error,
            }).catch(() => {});
        }
        io.stderr(`${JSON.stringify(errorDocument(error))}\n`);
        return exitCodeOf(error.code);
    } finally {
        release();
    }
}

/** Writes one complete line, ending the attempt when the reader has gone away. */
async function write(io: LoginIo, attempt: AbortController, event: object): Promise<void> {
    try {
        await io.writeLine(`${JSON.stringify({ apiVersion: 1, ...event })}\n`);
    } catch (error) {
        attempt.abort();
        throw new CliError("CANCELLED", "The command's output was closed before it finished.", {
            details: { cause: error instanceof Error ? error.message : String(error) },
        });
    }
}

/** The vault's metadata projection, so no engine credential snapshot reaches the stream. */
function projectEvent(event: LoginEvent): object {
    if (event.type !== "completed") return event;
    return {
        ...event,
        credential: projectCredential(event.credential),
        select: selectCommand(event.credential.provider, event.credential.reference),
    };
}

/** Owns cancellation while login runs; the SDK's hard-exit listeners would race its JSON error. */
function stopOn(attempt: AbortController): () => void {
    const stop = () => attempt.abort();
    const previous = (["SIGINT", "SIGTERM"] as const).map(signal => ({
        signal,
        listeners: process.rawListeners(signal),
    }));
    for (const { signal, listeners } of previous) {
        for (const listener of listeners) process.removeListener(signal, listener);
        process.on(signal, stop);
    }
    return () => {
        for (const { signal, listeners } of previous) {
            process.off(signal, stop);
            // Preserve original order and once wrappers, ahead of listeners added during login.
            for (let index = listeners.length - 1; index >= 0; index--) {
                process.prependListener(signal, listeners[index]!);
            }
        }
    };
}

function supportedMethod(id: string, method = describeLoginMethod(id)) {
    if (!method) {
        throw new CliError("NOT_FOUND", `This Pico's engine declares no login method "${id}".`, {
            details: { method: id, accepted: "pico providers list" },
        });
    }
    if (!method.supported) {
        throw new CliError("FAILED_PRECONDITION", method.unsupported as string, {
            details: { method: method.method, provider: method.provider },
        });
    }
    return method;
}

function asLoginCliError(failure: unknown): CliError {
    if (failure instanceof CliError) return failure;
    if (failure instanceof LoginError) {
        return new CliError(failure.code, failure.message, {
            retryable: failure.retryable,
            details: failure.details,
        });
    }
    const bridged = asCliError(failure);
    if (bridged instanceof CliError) return bridged;
    return new CliError("INTERNAL", failure instanceof Error ? failure.message : String(failure), {
        details: { command: "auth login" },
    });
}
