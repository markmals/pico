import { describe, expect, test } from "bun:test";

import { parseInvocation, USAGE } from "./invocation.ts";

/** A 32-bit xorshift, deterministic per seed, as in the event-mapper property tests. */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

const ARGUMENT_PIECES = [
    "--version",
    "-v",
    "--help",
    "acp",
    "file.txt",
    "",
    " ",
    "--",
    "-",
    "version",
];

/** Any argument list except the two the proposal gives a meaning: none, and exactly `--version`. */
function randomOtherArguments(next: (bound: number) => number): string[] {
    while (true) {
        const length = 1 + next(4);
        const args = Array.from(
            { length },
            () => ARGUMENT_PIECES[next(ARGUMENT_PIECES.length)] as string,
        );
        if (!(args.length === 1 && args[0] === "--version")) return args;
    }
}

describe("proposal.0002 pico's arguments", () => {
    test("no arguments with a piped stdin is the ACP agent, as Sesh launches it", () => {
        expect(parseInvocation([], false)).toEqual({ kind: "acp" });
    });

    test("no arguments at a terminal prints the usage and explains that Sesh launches pico", () => {
        const invocation = parseInvocation([], true);

        expect(invocation.kind).toBe("usage");
        if (invocation.kind !== "usage") return;
        expect(invocation.message.split("\n")[0]).toBe(USAGE);
        expect(invocation.message).toContain("Sesh");
        expect(invocation.message).toContain("ACP");
    });

    test.each([false, true])("--version asks for the version (stdin a terminal: %p)", terminal => {
        expect(parseInvocation(["--version"], terminal)).toEqual({ kind: "version" });
    });

    test.each([[["somefile"]], [["--help"]], [["--version", "extra"]], [["acp"]]])(
        "%p is a usage error",
        (args: string[]) => {
            const invocation = parseInvocation(args, false);

            expect(invocation).toEqual({ kind: "usage", message: `${USAGE}\n` });
        },
    );

    test("for any other argument list, pico prints the usage instead of starting ACP", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const next = randomSource(seed);
            for (const terminal of [false, true]) {
                const args = randomOtherArguments(next);
                const invocation = parseInvocation(args, terminal);

                expect({ args, kind: invocation.kind }).toEqual({ args, kind: "usage" });
            }
        }
    });

    test("the usage line names the only option", () => {
        expect(USAGE).toBe("usage: pico [--version]");
    });
});
