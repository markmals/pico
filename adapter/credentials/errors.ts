/**
 * Codes Pico credential operations report. They are the stable CLI codes plus the Keychain
 * conditions proposal 0009 adds, so a command surfaces one unchanged instead of
 * flattening every storage failure into one message.
 */
export type CredentialErrorCode =
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "AUTH_REQUIRED"
    | "CONFLICT"
    | "UNAVAILABLE"
    | "IO_ERROR"
    | "INTERNAL"
    | "KEYCHAIN_LOCKED"
    | "KEYCHAIN_ACCESS_DENIED"
    | "CANCELLED";

/** Codes a caller can retry unchanged: the condition is transient or externally fixable. */
const RETRYABLE: Partial<Record<CredentialErrorCode, true>> = {
    CONFLICT: true,
    UNAVAILABLE: true,
    KEYCHAIN_LOCKED: true,
};

/**
 * A credential operation that did not happen. `details` is a safe JSON object:
 * references, providers, native codes and OSStatus values, never payloads.
 */
export class CredentialError extends Error {
    readonly code: CredentialErrorCode;
    readonly retryable: boolean;
    readonly details: Record<string, unknown>;

    constructor(
        code: CredentialErrorCode,
        message: string,
        options?: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown },
    ) {
        super(message, { cause: options?.cause });
        this.name = "CredentialError";
        this.code = code;
        this.details = options?.details ?? {};
        this.retryable = options?.retryable ?? RETRYABLE[code] === true;
    }
}

/** The native bridge's failure shape, matched structurally so core never imports it. */
interface NativeKeychainFailure {
    code: string;
    status?: number;
}

function nativeFailure(error: unknown): NativeKeychainFailure | undefined {
    if (!(error instanceof Error) || !("code" in error)) return undefined;
    const code: unknown = error.code;
    if (typeof code !== "string" || !code.startsWith("KEYCHAIN_")) return undefined;
    const status: unknown = "status" in error ? error.status : undefined;
    return { code, status: typeof status === "number" ? status : undefined };
}

/**
 * A dialog-requiring item is a precondition, not a lock: rerunning the same
 * command fails the same way until the caller passes `--allow-keychain-ui`, so
 * reporting it as retryable would misdescribe it.
 */
const KEYCHAIN_CODES: Record<string, CredentialErrorCode> = {
    KEYCHAIN_UI_REQUIRED: "FAILED_PRECONDITION",
    KEYCHAIN_LOCKED: "KEYCHAIN_LOCKED",
    KEYCHAIN_ACCESS_DENIED: "KEYCHAIN_ACCESS_DENIED",
    KEYCHAIN_UNAVAILABLE: "UNAVAILABLE",
    KEYCHAIN_UNSUPPORTED_PLATFORM: "FAILED_PRECONDITION",
    KEYCHAIN_FAILED: "IO_ERROR",
};

const KEYCHAIN_EXPLANATIONS: Record<string, string> = {
    KEYCHAIN_UI_REQUIRED: "macOS needs permission for this item; retry with --allow-keychain-ui",
    KEYCHAIN_LOCKED: "the login Keychain is locked or unavailable",
    KEYCHAIN_ACCESS_DENIED: "macOS denied access to this item",
    KEYCHAIN_UNAVAILABLE: "Pico's Keychain bridge is not available in this build",
    KEYCHAIN_UNSUPPORTED_PLATFORM:
        "Pico stores credentials in the macOS Keychain, which this platform does not have",
    KEYCHAIN_FAILED: "the Keychain refused the operation",
};

/**
 * Translates a native Keychain failure into the vault's vocabulary, preserving the
 * native code and OSStatus as details. Anything else is an internal failure: the
 * bridge's contract is that it throws only its own typed errors.
 */
export function credentialErrorFromKeychain(
    error: unknown,
    context: { operation: string; reference: string; provider?: string },
): CredentialError {
    const native = nativeFailure(error);
    const details: Record<string, unknown> = {
        reference: context.reference,
        operation: context.operation,
    };
    if (context.provider) details.provider = context.provider;
    if (!native) {
        return new CredentialError(
            "INTERNAL",
            `Keychain ${context.operation} for ${context.reference} failed unexpectedly`,
            { details, cause: error },
        );
    }
    details.keychain = native.code;
    if (native.status !== undefined) details.status = native.status;
    if (native.code === "KEYCHAIN_UNSUPPORTED_PLATFORM") details.platform = process.platform;
    const explanation = KEYCHAIN_EXPLANATIONS[native.code] ?? "the Keychain refused the operation";
    return new CredentialError(
        KEYCHAIN_CODES[native.code] ?? "IO_ERROR",
        `Cannot ${context.operation} credential ${context.reference}: ${explanation}.`,
        { details, cause: error },
    );
}
