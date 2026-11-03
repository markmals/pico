import { describe, expect, test } from "bun:test";

import { CliError, errorDocument, exitCodeOf } from "./errors.ts";

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
