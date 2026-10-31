export const USAGE = "usage: pico [--version]";

const TERMINAL_HINT =
    "pico is an ACP agent: Sesh launches it and talks to it over stdin and stdout. Register its path in Sesh as a custom agent instead of running it here.";

export type Invocation = { kind: "acp" } | { kind: "version" } | { kind: "usage"; message: string };

/**
 * What one run of `pico` does. Sesh launches it with no arguments and a piped stdin, so
 * that form, and only that form, is the ACP agent.
 */
export function parseInvocation(args: readonly string[], stdinIsTerminal: boolean): Invocation {
    if (args.length === 1 && args[0] === "--version") return { kind: "version" };
    if (args.length > 0) return { kind: "usage", message: `${USAGE}\n` };
    if (stdinIsTerminal) return { kind: "usage", message: `${USAGE}\n${TERMINAL_HINT}\n` };
    return { kind: "acp" };
}
