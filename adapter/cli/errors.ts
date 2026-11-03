export type ErrorCode =
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "CONFLICT"
    | "UNAVAILABLE"
    | "IO_ERROR"
    | "INTERNAL";

export type ErrorDocument = {
    apiVersion: 1;
    error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        details: Record<string, unknown>;
    };
};

/**
 * A failure a `pico` command reports to its client. `UNAVAILABLE` is the one code whose
 * retryability depends on the cause, so a caller that knows the credential store is busy
 * constructs it retryable.
 */
export class CliError extends Error {
    readonly code: ErrorCode;
    readonly details: Record<string, unknown>;
    readonly retryable: boolean;

    constructor(
        code: ErrorCode,
        message: string,
        options?: { details?: Record<string, unknown>; retryable?: boolean },
    ) {
        super(message);
        this.name = "CliError";
        this.code = code;
        this.details = options?.details ?? {};
        this.retryable = options?.retryable ?? code === "CONFLICT";
    }
}

export function exitCodeOf(code: ErrorCode): number {
    return code === "INVALID_ARGUMENT" ? 2 : 1;
}

export function retryableByDefault(code: ErrorCode): boolean {
    return code === "CONFLICT";
}

export function errorDocument(error: CliError): ErrorDocument {
    return {
        apiVersion: 1,
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            details: error.details,
        },
    };
}
