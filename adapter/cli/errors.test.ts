import { describe, expect, test } from "bun:test";

import { CliError, errorDocument, exitCodeOf, retryableByDefault } from "./errors.ts";

describe("proposal.0007 cli errors", () => {
    test("INVALID_ARGUMENT exits 2 and every other code exits 1", () => {
        expect(exitCodeOf("INVALID_ARGUMENT")).toBe(2);

        for (const code of [
            "NOT_FOUND",
            "FAILED_PRECONDITION",
            "CONFLICT",
            "UNAVAILABLE",
            "IO_ERROR",
            "INTERNAL",
        ] as const) {
            expect({ code, exit: exitCodeOf(code) }).toEqual({ code, exit: 1 });
        }
    });

    test("only CONFLICT is retryable without being told otherwise", () => {
        expect(new CliError("CONFLICT", "the file changed").retryable).toBe(true);

        for (const code of [
            "INVALID_ARGUMENT",
            "NOT_FOUND",
            "FAILED_PRECONDITION",
            "UNAVAILABLE",
            "IO_ERROR",
            "INTERNAL",
        ] as const) {
            expect({ code, retryable: new CliError(code, "no").retryable }).toEqual({
                code,
                retryable: false,
            });
        }
    });

    test("UNAVAILABLE is retryable when the credential store reports it is busy", () => {
        const busy = new CliError("UNAVAILABLE", "the credential store is locked", {
            retryable: true,
            details: { credentialStore: "/store.db", cause: "database is locked" },
        });

        expect(busy.retryable).toBe(true);
        expect(busy.details).toEqual({ credentialStore: "/store.db", cause: "database is locked" });
    });

    test("the error document carries apiVersion, the code, the message, retryability and details", () => {
        const error = new CliError("NOT_FOUND", "no model anthropic/nope", {
            details: { model: "anthropic/nope", command: "pico models list" },
        });

        expect(errorDocument(error)).toEqual({
            apiVersion: 1,
            error: {
                code: "NOT_FOUND",
                message: "no model anthropic/nope",
                retryable: false,
                details: { model: "anthropic/nope", command: "pico models list" },
            },
        });
    });

    test("an error with no details carries an empty details object", () => {
        expect(errorDocument(new CliError("INTERNAL", "boom")).error.details).toEqual({});
    });
});

describe("proposal.0009 the codes a credential caller must tell apart", () => {
    const added = [
        "AUTH_REQUIRED",
        "KEYCHAIN_LOCKED",
        "KEYCHAIN_ACCESS_DENIED",
        "CANCELLED",
        "TIMED_OUT",
    ] as const;

    test("each one exits 1, because none of them is a mistake in the command", () => {
        for (const code of added) {
            expect({ code, exit: exitCodeOf(code) }).toEqual({ code, exit: 1 });
        }
    });

    test("the ones that pass on their own are retryable, and the rest are not", () => {
        for (const code of ["KEYCHAIN_LOCKED", "TIMED_OUT"] as const) {
            expect({ code, retryable: retryableByDefault(code) }).toEqual({
                code,
                retryable: true,
            });
        }
        for (const code of ["AUTH_REQUIRED", "KEYCHAIN_ACCESS_DENIED", "CANCELLED"] as const) {
            expect({ code, retryable: retryableByDefault(code) }).toEqual({
                code,
                retryable: false,
            });
        }
    });

    test("a Keychain refusal carries its platform status without any payload", () => {
        const denied = new CliError("KEYCHAIN_ACCESS_DENIED", "Pico may not read the item", {
            details: { reference: "0c5f", keychain: "ERR_ACCESS_DENIED", status: -25293 },
        });

        expect(errorDocument(denied).error).toEqual({
            code: "KEYCHAIN_ACCESS_DENIED",
            message: "Pico may not read the item",
            retryable: false,
            details: { reference: "0c5f", keychain: "ERR_ACCESS_DENIED", status: -25293 },
        });
    });
});
