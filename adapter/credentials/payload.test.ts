import type { AuthCredential } from "@oh-my-pi/pi-ai";

import { describe, expect, test } from "bun:test";

import { CredentialError } from "./errors.ts";
import {
    assertStorableCredential,
    decodeCredentialPayload,
    encodeCredentialPayload,
} from "./payload.ts";

const REFERENCE = "6f3a1c90-0000-4000-8000-00000000beef";
const API_KEY = "pico-fake-api-key-cGF5bG9hZA";

const expected = { reference: REFERENCE, provider: "openai" };

const apiKey: AuthCredential = { type: "api_key", key: API_KEY };

const oauth: AuthCredential = {
    type: "oauth",
    access: "pico-fake-access",
    refresh: "pico-fake-refresh",
    expires: 4_000_000_000_000,
    email: "person@example.com",
};

function thrownBy(action: () => unknown): unknown {
    try {
        action();
        return undefined;
    } catch (error) {
        return error;
    }
}

function decodeFailure(text: string): CredentialError {
    const error = thrownBy(() => decodeCredentialPayload(expected, text));
    expect(error).toBeInstanceOf(CredentialError);
    return error as CredentialError;
}

describe("proposal.0009 the Keychain payload", () => {
    test("a stored payload round-trips its credential and identity", () => {
        for (const credential of [apiKey, oauth]) {
            const text = encodeCredentialPayload({
                reference: REFERENCE,
                provider: "openai",
                kind: credential.type,
                credential,
            });

            expect(decodeCredentialPayload(expected, text)).toEqual({
                reference: REFERENCE,
                provider: "openai",
                kind: credential.type,
                credential,
            });
        }
    });

    test("an API key keeps the SDK's login source", () => {
        const credential: AuthCredential = { type: "api_key", key: API_KEY, source: "login" };
        const text = encodeCredentialPayload({
            reference: REFERENCE,
            provider: "openai",
            kind: "api_key",
            credential,
        });

        expect(decodeCredentialPayload(expected, text).credential).toEqual(credential);
    });

    test("a payload that is not a versioned document is refused", () => {
        for (const text of ["", "not json", "[]", "null", '{"version":2}', '{"version":"1"}']) {
            expect(decodeFailure(text).code).toBe("FAILED_PRECONDITION");
        }
    });

    test("a payload whose identity is not the reference being read is refused", () => {
        const text = encodeCredentialPayload({
            reference: "11111111-0000-4000-8000-000000000000",
            provider: "openai",
            kind: "api_key",
            credential: apiKey,
        });

        expect(decodeFailure(text).details).toMatchObject({ reference: REFERENCE });
    });

    test("a payload stored under another provider is refused", () => {
        const text = encodeCredentialPayload({
            reference: REFERENCE,
            provider: "anthropic",
            kind: "api_key",
            credential: apiKey,
        });

        expect(decodeFailure(text).code).toBe("FAILED_PRECONDITION");
    });

    test("a payload whose kind contradicts its credential is refused", () => {
        const text = JSON.stringify({
            version: 1,
            reference: REFERENCE,
            provider: "openai",
            kind: "oauth",
            credential: apiKey,
        });

        expect(decodeFailure(text).code).toBe("FAILED_PRECONDITION");
    });

    test("a credential missing the fields the SDK requires is refused", () => {
        const incomplete = [
            { type: "api_key" },
            { type: "api_key", key: 7 },
            { type: "oauth", access: "a", refresh: "b" },
            { type: "oauth", access: "a", expires: 1 },
            { type: "other", key: "a" },
        ];

        for (const credential of incomplete) {
            const text = JSON.stringify({
                version: 1,
                reference: REFERENCE,
                provider: "openai",
                kind: "api_key",
                credential,
            });
            expect(decodeFailure(text).code).toBe("FAILED_PRECONDITION");
        }
    });

    test("a refusal names the reference and never the payload", () => {
        const text = JSON.stringify({
            version: 1,
            reference: REFERENCE,
            provider: "openai",
            kind: "api_key",
            credential: { type: "api_key", key: "" },
        });

        const failure = decodeFailure(text);

        expect(failure.details).toMatchObject({ reference: REFERENCE });
        expect(failure.message).not.toContain(API_KEY);
        expect(JSON.stringify(failure.details)).not.toContain("api_key");
    });

    test("an unstorable API key is refused before anything is written", () => {
        for (const key of ["", "   ", "abc\u0000def", "x".repeat(65 * 1024)]) {
            const failure = thrownBy(() =>
                assertStorableCredential({ type: "api_key", key }),
            ) as CredentialError;
            expect(failure.code).toBe("INVALID_ARGUMENT");
        }
    });

    test("a refused API key is never echoed back by the refusal", () => {
        const marker = "pico-fake-marker-c2VjcmV0";

        for (const key of [`${marker}\u0000tail`, `${marker}${"x".repeat(65 * 1024)}`]) {
            const failure = thrownBy(() =>
                assertStorableCredential({ type: "api_key", key }),
            ) as CredentialError;
            expect(failure.code).toBe("INVALID_ARGUMENT");
            expect(failure.message).not.toContain(marker);
            expect(JSON.stringify(failure.details)).not.toContain(marker);
        }
    });

    test("a storable credential passes its own boundary check", () => {
        expect(thrownBy(() => assertStorableCredential(apiKey))).toBeUndefined();
        expect(thrownBy(() => assertStorableCredential(oauth))).toBeUndefined();
    });

    test("an expiry that cannot survive the payload format is refused before storage", () => {
        for (const expires of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            const failure = thrownBy(() =>
                assertStorableCredential({ ...oauth, expires }),
            ) as CredentialError;

            expect(failure?.code).toBe("INVALID_ARGUMENT");
        }
    });

    test("an OAuth grant without usable tokens is refused", () => {
        const failure = thrownBy(() =>
            assertStorableCredential({
                type: "oauth",
                access: "",
                refresh: "r",
                expires: 1,
            } as AuthCredential),
        ) as CredentialError;

        expect(failure.code).toBe("INVALID_ARGUMENT");
    });
});
