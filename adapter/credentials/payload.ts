import type { AuthCredential, OAuthCredential } from "@oh-my-pi/pi-ai";

import type { CredentialKind } from "./types.ts";

import { CredentialError } from "./errors.ts";

/** The payload layout. A reader refuses anything it was not written to understand. */
const PAYLOAD_VERSION = 1;

/** The same bound the stdin command enforces, applied again at the storage boundary. */
const MAX_KEY_BYTES = 64 * 1024;

/** What one Keychain item holds: its own identity and the SDK credential it stores. */
export interface CredentialPayload {
    reference: string;
    provider: string;
    kind: CredentialKind;
    credential: AuthCredential;
}

export function encodeCredentialPayload(payload: CredentialPayload): string {
    return JSON.stringify({ version: PAYLOAD_VERSION, ...payload });
}

/**
 * Reads one item's payload, proving it is the credential the index named. A
 * payload that is unreadable, from another version, or for another identity is a
 * failed precondition on that reference: distinguishable from a missing item and
 * from denied access, and reported without any of the bytes it refused.
 */
export function decodeCredentialPayload(
    expected: { reference: string; provider: string },
    text: string,
): CredentialPayload {
    const document = parseObject(text);
    if (!document) throw malformed(expected.reference, "the payload is not a JSON object");
    if (document.version !== PAYLOAD_VERSION) {
        throw malformed(expected.reference, "the payload version is not supported");
    }
    if (document.reference !== expected.reference) {
        throw malformed(expected.reference, "the payload belongs to another credential");
    }
    if (document.provider !== expected.provider) {
        throw malformed(expected.reference, "the payload belongs to another provider");
    }
    const credential = validCredential(document.credential);
    if (!credential) throw malformed(expected.reference, "the stored credential is incomplete");
    if (document.kind !== credential.type) {
        throw malformed(expected.reference, "the payload kind contradicts its credential");
    }
    return {
        reference: expected.reference,
        provider: expected.provider,
        kind: credential.type,
        credential,
    };
}

/**
 * Refuses a credential the vault must not write: one the SDK could not use, or key
 * material that cannot survive a Keychain round trip. The message never repeats the
 * value it rejected.
 */
export function assertStorableCredential(credential: AuthCredential): void {
    if (credential.type === "api_key") {
        const key = credential.key;
        if (typeof key !== "string" || key.trim().length === 0) {
            throw unstorable("an API key cannot be empty");
        }
        if (key.includes("\u0000")) throw unstorable("an API key cannot contain a NUL byte");
        if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
            throw unstorable(`an API key cannot exceed ${MAX_KEY_BYTES} bytes`);
        }
        return;
    }
    if (!validCredential(credential)) {
        throw unstorable(
            "an OAuth grant needs an access token, a refresh-token string and a finite expiry",
        );
    }
}

function parseObject(text: string): Record<string, unknown> | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
}

/** The credential shapes the SDK's own store round-trips, checked field by field. */
function validCredential(value: unknown): AuthCredential | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.type === "api_key") {
        if (typeof candidate.key !== "string" || candidate.key.length === 0) return undefined;
        return candidate.source === "login"
            ? { type: "api_key", key: candidate.key, source: "login" }
            : { type: "api_key", key: candidate.key };
    }
    if (candidate.type !== "oauth") return undefined;
    if (typeof candidate.access !== "string" || candidate.access.length === 0) return undefined;
    if (typeof candidate.refresh !== "string") return undefined;
    if (typeof candidate.expires !== "number" || !Number.isFinite(candidate.expires))
        return undefined;
    return candidate as OAuthCredential;
}

function malformed(reference: string, problem: string): CredentialError {
    return new CredentialError(
        "FAILED_PRECONDITION",
        `The Keychain item for credential ${reference} is unusable: ${problem}.`,
        { details: { reference, problem } },
    );
}

function unstorable(problem: string): CredentialError {
    return new CredentialError(
        "INVALID_ARGUMENT",
        `Pico cannot store this credential: ${problem}.`,
        {
            details: { problem },
        },
    );
}
