import { describe, expect, test } from "bun:test";

import type { PicoSettings } from "./settings-document.ts";

import { readSettingsState, revisionOf, serializeSettings } from "./settings-document.ts";

/**
 * A 32-bit xorshift, deterministic per seed, as the session event mapper's invariants use: a
 * multiplying generator loses its low bits once the state passes 2^53 and silently collapses
 * the small moduli these generators take.
 */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

/** Characters a settings value may really hold, including ones JSON has to escape. */
const CHARACTERS = [..."ab/-_. ", '"', "\\", "\n", "é", "日", "🙂", "\u0000"];

function randomText(next: (bound: number) => number): string {
    let text = "";
    const length = 1 + next(8);
    for (let index = 0; index < length; index++) {
        text += CHARACTERS[next(CHARACTERS.length)] as string;
    }
    return text;
}

const AUTO_BACKGROUND: (boolean | null)[] = [true, false, null];

/** Provider ids a binding map may really hold, beside the references they select. */
const PROVIDERS = ["anthropic", "openai-codex", "a/b", "日", "x-1"];

function randomBindings(next: (bound: number) => number): Record<string, string> {
    const bindings: Record<string, string> = {};
    const count = next(4);
    for (let index = 0; index < count; index++) {
        bindings[PROVIDERS[next(PROVIDERS.length)] as string] = randomText(next);
    }
    return bindings;
}

function randomItem(next: (bound: number) => number): PicoSettings {
    const autoBackground = AUTO_BACKGROUND[next(AUTO_BACKGROUND.length)] as boolean | null;
    const providerCredentials = randomBindings(next);
    if (next(5) === 0) {
        return { defaultModel: null, defaultThinking: null, autoBackground, providerCredentials };
    }
    return {
        defaultModel: randomText(next),
        defaultThinking: randomText(next),
        autoBackground,
        providerCredentials,
    };
}

const VERSIONS: unknown[] = [1, 1, 2, 2, 2, 3, 7, 1000, 1.5, "1", 0, -3, true, null, { major: 1 }];
const MEMBER_VALUES: unknown[] = [
    "high",
    "anthropic/claude-sonnet-5-5",
    "日 /x",
    "",
    5,
    true,
    null,
    [],
];
const UNKNOWN_KEYS = ["flavour", "defaultmodel", "extra", "VERSION"];
const BACKGROUND_VALUES: unknown[] = [true, false, "on", "off", 1, 0, null, []];
const BINDING_VALUES: unknown[] = [
    { anthropic: "ref-a" },
    { anthropic: "ref-a", "openai-codex": "ref-b" },
    {},
    { anthropic: "" },
    { "": "ref-a" },
    { anthropic: 7 },
    { anthropic: null },
    [],
    "ref-a",
    null,
];

function randomCandidate(next: (bound: number) => number): Record<string, unknown> {
    const candidate: Record<string, unknown> = {};
    if (next(12) !== 0) candidate["version"] = VERSIONS[next(VERSIONS.length)];
    if (next(3) !== 0) candidate["defaultModel"] = MEMBER_VALUES[next(MEMBER_VALUES.length)];
    if (next(3) !== 0) candidate["defaultThinking"] = MEMBER_VALUES[next(MEMBER_VALUES.length)];
    if (next(3) === 0) {
        candidate["autoBackground"] = BACKGROUND_VALUES[next(BACKGROUND_VALUES.length)];
    }
    if (next(3) === 0) {
        candidate["providerCredentials"] = BINDING_VALUES[next(BINDING_VALUES.length)];
    }
    if (next(4) === 0) candidate[UNKNOWN_KEYS[next(UNKNOWN_KEYS.length)] as string] = "anything";
    return candidate;
}

/** What the settings versions define, written out independently of the schema they compare against. */
function expectedStatus(candidate: Record<string, unknown>): string {
    const version = candidate["version"];
    if (typeof version === "number" && Number.isInteger(version) && version > 2) {
        return "unsupported";
    }
    if (version !== 1 && version !== 2) return "invalid";
    const defined = ["version", "defaultModel", "defaultThinking", "autoBackground"];
    if (version === 2) defined.push("providerCredentials");
    if (Object.keys(candidate).some(key => !defined.includes(key))) return "invalid";
    const background = candidate["autoBackground"];
    if (background !== undefined && typeof background !== "boolean") return "invalid";
    if (!bindingsAreValid(candidate["providerCredentials"])) return "invalid";
    const model = candidate["defaultModel"];
    const thinking = candidate["defaultThinking"];
    if (model === undefined && thinking === undefined) return "valid";
    if (typeof model !== "string" || typeof thinking !== "string") return "invalid";
    return model.length > 0 && thinking.length > 0 ? "valid" : "invalid";
}

/** A binding map names providers and credential references, both non-empty text. */
function bindingsAreValid(bindings: unknown): boolean {
    if (bindings === undefined) return true;
    if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) return false;
    return Object.entries(bindings).every(
        ([provider, reference]) =>
            provider.length > 0 && typeof reference === "string" && reference.length > 0,
    );
}

function randomBytes(next: (bound: number) => number): Uint8Array {
    const bytes = new Uint8Array(next(17));
    for (let index = 0; index < bytes.length; index++) bytes[index] = next(256);
    return bytes;
}

const CASES = 400;

describe("proposal.0007 settings file invariants", () => {
    test("every item Pico serializes reads back as the same valid settings, at those bytes' revision", () => {
        const counts = {
            withDefault: 0,
            withoutDefault: 0,
            needingEscapes: 0,
            nonAscii: 0,
            backgroundOn: 0,
            backgroundOff: 0,
            backgroundUnset: 0,
            bound: 0,
            unbound: 0,
        };

        for (let seed = 1; seed <= CASES; seed++) {
            const next = randomSource(seed);
            const item = randomItem(next);
            const saved = `${item.defaultModel ?? ""}${item.defaultThinking ?? ""}`;
            if (item.defaultModel === null) counts.withoutDefault++;
            else counts.withDefault++;
            if (['"', "\\", "\n", "\u0000"].some(escaped => saved.includes(escaped))) {
                counts.needingEscapes++;
            }
            if (/[^\u0020-\u007e]/.test(saved)) counts.nonAscii++;
            if (item.autoBackground === true) counts.backgroundOn++;
            if (item.autoBackground === false) counts.backgroundOff++;
            if (item.autoBackground === null) counts.backgroundUnset++;
            if (Object.keys(item.providerCredentials).length > 0) counts.bound++;
            else counts.unbound++;
            const bytes = new TextEncoder().encode(serializeSettings(item));

            expect(readSettingsState(bytes)).toEqual({
                status: "valid",
                revision: revisionOf(bytes),
                item,
            });
        }

        expect(counts.withDefault).toBeGreaterThan(0);
        expect(counts.withoutDefault).toBeGreaterThan(0);
        expect(counts.needingEscapes).toBeGreaterThan(0);
        expect(counts.nonAscii).toBeGreaterThan(0);
        expect(counts.backgroundOn).toBeGreaterThan(0);
        expect(counts.backgroundOff).toBeGreaterThan(0);
        expect(counts.backgroundUnset).toBeGreaterThan(0);
        expect(counts.bound).toBeGreaterThan(0);
        expect(counts.unbound).toBeGreaterThan(0);
    });

    test("a JSON object is valid only when it is exactly a version 1 or version 2 document, and a later integer version is unsupported", () => {
        const counts: Record<string, number> = { valid: 0, unsupported: 0, invalid: 0 };

        for (let seed = 1; seed <= CASES; seed++) {
            const next = randomSource(seed * 2_654_435_761);
            const candidate = randomCandidate(next);
            const status = expectedStatus(candidate);
            counts[status] = (counts[status] ?? 0) + 1;
            const bytes = new TextEncoder().encode(JSON.stringify(candidate));

            expect([JSON.stringify(candidate), readSettingsState(bytes).status]).toEqual([
                JSON.stringify(candidate),
                status,
            ]);
        }

        expect(counts["valid"]).toBeGreaterThan(0);
        expect(counts["unsupported"]).toBeGreaterThan(0);
        expect(counts["invalid"]).toBeGreaterThan(0);
    });

    test("a revision is sha256 and its digest, the same for the same bytes and different for different bytes", () => {
        let differingPairs = 0;

        for (let seed = 1; seed <= CASES; seed++) {
            const next = randomSource(seed * 97);
            const left = randomBytes(next);
            const right = randomBytes(next);
            const revision = revisionOf(left);

            expect(revision).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(revisionOf(Uint8Array.from(left))).toBe(revision);
            const same =
                left.length === right.length && left.every((byte, at) => byte === right[at]);
            if (!same) differingPairs++;
            expect(revisionOf(right) === revision).toBe(same);
        }

        expect(differingPairs).toBeGreaterThan(0);
    });
});
