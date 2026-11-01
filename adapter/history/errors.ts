/**
 * Why Pico could not create, open or list a stored conversation.
 *
 * - `not-found`: no journal in Pico's storage carries that identity.
 * - `invalid`: the request itself is wrong, or the journal it names cannot be
 *   accepted as the conversation it claims to be.
 * - `busy`: the conversation is attached somewhere else and will not be forked.
 * - `storage`: Pico's own storage could not be read, written or trusted.
 */
export type SessionStoreErrorKind = "not-found" | "invalid" | "busy" | "storage";

/** A storage failure that names the conversation it is about and keeps its cause. */
export class SessionStoreError extends Error {
    readonly kind: SessionStoreErrorKind;
    /** The conversation the failure is about, when the request named one. */
    readonly sessionId: string | undefined;

    constructor(
        kind: SessionStoreErrorKind,
        message: string,
        options: { sessionId?: string; cause?: unknown } = {},
    ) {
        super(message, { cause: options.cause });
        this.name = "SessionStoreError";
        this.kind = kind;
        this.sessionId = options.sessionId;
    }
}
