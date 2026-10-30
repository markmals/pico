// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-mode.ts (MIT; see THIRD-PARTY-NOTICES.md).

/**
 * Hands stdout to the ACP stream alone.
 *
 * Every ordinary writer — Pico, OMP, an extension, a dependency — is redirected
 * to stderr, and the preserved file descriptor is returned for the protocol
 * stream. Call this before loading any module that could print, because a
 * single stray line on stdout corrupts the client's message stream.
 */
export function isolateStdout(): WritableStream<Uint8Array> {
    const writeToStdout = process.stdout.write.bind(process.stdout);

    // Same call signature, different destination; the overload set is identical.
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    console.log = console.error;
    console.info = console.error;
    console.debug = console.error;

    return new WritableStream<Uint8Array>({
        write(chunk) {
            if (writeToStdout(chunk)) return undefined;
            const drained = Promise.withResolvers<void>();
            process.stdout.once("drain", () => drained.resolve());
            return drained.promise;
        },
    });
}
