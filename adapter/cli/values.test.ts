import { describe, expect, test } from "bun:test";

import { describeValueFormat, isValidValue } from "./values.ts";

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

const SLASHLESS_PIECES = ["anthropic", "claude-sonnet-5-5", "", " ", "openai", "-", "gpt.5", "x"];
const HEX = "0123456789abcdef";

function randomHex(next: (bound: number) => number, length: number): string {
    return Array.from({ length }, () => HEX[next(HEX.length)] as string).join("");
}

describe("proposal.0007 command line value formats", () => {
    test("a model is a provider and an id separated by a slash", () => {
        expect(isValidValue("model", "anthropic/claude-sonnet-5-5")).toBe(true);
        expect(isValidValue("model", "openrouter/anthropic/claude-sonnet-5-5")).toBe(true);
    });

    test.each([["claude-sonnet-5-5"], ["/claude-sonnet-5-5"], ["anthropic/"], ["/"], [""], ["  "]])(
        "%p is not a model",
        (raw: string) => {
            expect(isValidValue("model", raw)).toBe(false);
        },
    );

    test("for any value without a slash, the model format rejects it", () => {
        const next = randomSource(7);
        for (let seed = 0; seed < 300; seed++) {
            const length = 1 + next(3);
            const raw = Array.from(
                { length },
                () => SLASHLESS_PIECES[next(SLASHLESS_PIECES.length)] as string,
            ).join("");

            expect({ raw, valid: isValidValue("model", raw) }).toEqual({ raw, valid: false });
        }
    });

    test("a revision is none, or sha256 and 64 lowercase hex characters", () => {
        const next = randomSource(11);

        expect(isValidValue("revision", "none")).toBe(true);
        for (let seed = 0; seed < 100; seed++) {
            const digest = randomHex(next, 64);

            expect({ digest, valid: isValidValue("revision", `sha256:${digest}`) }).toEqual({
                digest,
                valid: true,
            });
        }
    });

    test.each([
        ["None"],
        ["sha256:"],
        [`sha256:${"a".repeat(63)}`],
        [`sha256:${"a".repeat(65)}`],
        [`sha256:${"A".repeat(64)}`],
        [`sha1:${"a".repeat(64)}`],
        [""],
    ])("%p is not a revision", (raw: string) => {
        expect(isValidValue("revision", raw)).toBe(false);
    });

    test("text is any value that is not empty", () => {
        expect(isValidValue("text", "high")).toBe(true);
        expect(isValidValue("text", "")).toBe(false);
        expect(isValidValue("text", "   ")).toBe(false);
    });

    test("every format describes what it accepts", () => {
        expect(describeValueFormat("model")).toContain("provider/");
        expect(describeValueFormat("revision")).toContain("sha256:");
        expect(describeValueFormat("text")).not.toBe("");
    });
});

describe("proposal.0009 the value formats a credential command takes", () => {
    test.each([["openai"], ["openai-codex"], ["llama.cpp"], ["gpt-4o-2"], ["a"]])(
        "%p is a provider id",
        (raw: string) => {
            expect(isValidValue("provider", raw)).toBe(true);
        },
    );

    test.each([
        ["OpenAI"],
        ["openai/gpt"],
        ["-openai"],
        ["openai "],
        ["open ai"],
        [""],
        ["openai\n"],
    ])("%p is not a provider id", (raw: string) => {
        expect(isValidValue("provider", raw)).toBe(false);
    });

    test("a reference is the lowercase UUID Pico assigned to a credential", () => {
        const next = randomSource(23);
        for (let seed = 0; seed < 100; seed++) {
            const uuid = [8, 4, 4, 4, 12].map(length => randomHex(next, length)).join("-");

            expect({ uuid, valid: isValidValue("reference", uuid) }).toEqual({ uuid, valid: true });
        }
    });

    test.each([
        ["0F8E2C1A-4B6D-4E2F-9A1B-7C3D5E8F0A2B"],
        ["0f8e2c1a4b6d4e2f9a1b7c3d5e8f0a2b"],
        ["0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2"],
        ["0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2bb"],
        ["not-a-uuid"],
        [""],
    ])("%p is not a reference", (raw: string) => {
        expect(isValidValue("reference", raw)).toBe(false);
    });

    test("both formats describe what they accept", () => {
        expect(describeValueFormat("provider")).toContain("provider");
        expect(describeValueFormat("reference")).toContain("credentials list");
    });
});
