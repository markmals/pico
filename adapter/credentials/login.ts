import type { AuthCredential, OAuthCredential, OAuthLoginController } from "@oh-my-pi/pi-ai";
import type { OAuthErrorKind } from "@oh-my-pi/pi-ai/error";

import type { LoginMethodInfo } from "./providers.ts";
import type { CredentialMetadata } from "./types.ts";
import type { CredentialVault } from "./vault.ts";

import { CredentialError } from "./errors.ts";
import { describedMethod, describeLoginMethod } from "./providers.ts";

/** How long SDK authorization may run; the synchronous Keychain commit follows outside it. */
export const LOGIN_DEADLINE_MS = 10 * 60 * 1000;

export type LoginErrorCode =
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "AUTH_REQUIRED"
    | "CANCELLED"
    | "TIMED_OUT"
    | "CONFLICT"
    | "UNAVAILABLE"
    | "INTERNAL";

/** A login that did not store a credential, with the category its caller must distinguish. */
export class LoginError extends Error {
    readonly code: LoginErrorCode;
    readonly retryable: boolean;
    readonly details: Record<string, unknown>;

    constructor(
        code: LoginErrorCode,
        message: string,
        details: Record<string, unknown> = {},
        retryable = code === "TIMED_OUT" || code === "UNAVAILABLE" || code === "CONFLICT",
    ) {
        super(message);
        this.name = "LoginError";
        this.code = code;
        this.retryable = retryable;
        this.details = details;
    }
}

interface EventFields {
    attemptId: string;
    sequence: number;
}

/** One event's own fields; the attempt adds the identity and order every event carries. */
export type LoginEventBody =
    | { type: "started"; method: string; provider: string; deadlineSeconds: number }
    | {
          type: "authorization";
          url: string;
          launchUrl: string | null;
          instructions: string | null;
          localBrowser: boolean;
      }
    | { type: "progress"; message: string }
    | {
          type: "completed";
          stored: true;
          revision: string;
          credential: CredentialMetadata;
          select: string;
      };

export type LoginEvent = EventFields & LoginEventBody;

export interface LoginOptions {
    method: string;
    vault: CredentialVault;
    emit(event: LoginEvent): void;
    signal?: AbortSignal;
    deadlineMs?: number;
}

/**
 * Runs one login with the engine's own flow and commits its result to Pico's vault.
 *
 * The flow runs against an isolated in-memory credential store, because the engine's login
 * path replaces a provider's other rows; staging keeps that rewrite away from the authoritative
 * vault, so an API key already stored for the same provider survives. Nothing is published
 * before the Keychain write succeeds.
 */
export async function runLogin(options: LoginOptions): Promise<CredentialMetadata> {
    const method = await resolveLoginMethod(options.method);
    if (!method) {
        throw new LoginError(
            "NOT_FOUND",
            `This Pico's engine declares no login method "${options.method}".`,
            { method: options.method, accepted: "pico providers list" },
        );
    }
    if (!method.supported) {
        throw new LoginError("FAILED_PRECONDITION", method.unsupported as string, {
            method: method.method,
            provider: method.provider,
        });
    }

    const attemptId = crypto.randomUUID();
    const deadlineMs = options.deadlineMs ?? LOGIN_DEADLINE_MS;
    const startingRevision = options.vault.revision();
    let sequence = 0;
    const emit = (event: LoginEventBody) =>
        options.emit({ attemptId, sequence: sequence++, ...event });

    emit({
        type: "started",
        method: method.method,
        provider: method.provider,
        deadlineSeconds: Math.round(deadlineMs / 1000),
    });

    const deadline = AbortSignal.timeout(deadlineMs);
    const attempt = new AbortController();
    const cancellation = options.signal
        ? AbortSignal.any([options.signal, attempt.signal])
        : attempt.signal;
    const signal = AbortSignal.any([cancellation, deadline]);
    const refusals = { asked: false };

    try {
        // The attempt is bounded by Pico, not by the provider: a flow that never settles still ends.
        const credential = await Promise.race([
            exchange(
                method.method,
                method.provider,
                controllerFor(method, emit, signal, refusals, attempt),
            ),
            ended(signal, deadline, method.method),
        ]);
        // Synchronous by contract: nothing may interleave between the durable commit and the
        // completion event that reports it.
        const stored = options.vault.create(method.provider, credential, {
            ifRevision: startingRevision,
            signal: cancellation,
        });
        emit({
            type: "completed",
            stored: true,
            revision: options.vault.revision(),
            credential: stored,
            select: `pico providers update ${stored.provider} --credential ${stored.reference}`,
        });
        return stored;
    } catch (failure) {
        throw loginFailure(failure, method.method, method.provider, refusals, signal, deadline);
    } finally {
        // Releases the attempt's listeners even when the flow is still waiting on the provider.
        attempt.abort();
    }
}

/**
 * The method to run. The compiled policies describe every built-in login without loading the
 * engine; a method an extension registered at runtime is known only to the engine's own
 * registry, which is safe to load here because a real login already needs it.
 */
export async function resolveLoginMethod(id: string): Promise<LoginMethodInfo | undefined> {
    const declared = describeLoginMethod(id);
    if (declared) return declared;
    const { getOAuthProvider } = await import("@oh-my-pi/pi-ai/registry");
    const registered = getOAuthProvider(id);
    if (!registered) return undefined;
    return describedMethod(id, registered.name, undefined, registered.storeCredentialsAs);
}

/**
 * The staged login. The isolated store is read back rather than trusting the engine's return
 * value, so the credential Pico commits is the one the flow actually persisted.
 */
async function exchange(
    method: string,
    provider: string,
    controller: OAuthLoginController,
): Promise<OAuthCredential> {
    // Loaded here so provider discovery and previews never pull the engine's runtime in.
    const { AuthStorage } = await import("@oh-my-pi/pi-ai");
    const { createMemoryCredentialStore } = await import("./memory-store.ts");
    const store = createMemoryCredentialStore();
    const staging = new AuthStorage(store);
    try {
        await staging.credentials.reload();
        const identity = await staging.oauth.login(method, controller);
        if (identity?.type === "api_key") throw apiKeyResult(provider);
        const staged = store
            .listAuthCredentials(provider)
            .map(row => row.credential)
            .filter((credential): credential is OAuthCredential => credential.type === "oauth")
            .at(-1);
        if (!staged) throw noCredential(method, provider, store.listAuthCredentials());
        return staged;
    } finally {
        staging.close();
    }
}

/**
 * Declared browser flows get no optional paste fallback: the SDK races it against the
 * callback, so rejecting that fallback would cancel a valid browser login. Undeclared
 * interactions abort the attempt, even if the flow catches the callback's rejection.
 */
function controllerFor(
    method: LoginMethodInfo,
    emit: (event: LoginEventBody) => void,
    signal: AbortSignal,
    refusals: { asked: boolean },
    attempt: AbortController,
): OAuthLoginController {
    const refuse = (what: string) => {
        refusals.asked = true;
        attempt.abort();
        return Promise.reject(
            new LoginError(
                "FAILED_PRECONDITION",
                `This login asked Pico for ${what}; pico auth login answers no questions.`,
            ),
        );
    };
    return {
        onAuth: info =>
            emit({
                type: "authorization",
                url: info.url,
                launchUrl: info.launchUrl ?? null,
                instructions: info.instructions ?? null,
                // A loopback launch URL exists only when a callback server on this machine serves it.
                localBrowser: info.launchUrl !== undefined,
            }),
        // SDK progress can contain exchange material; report only that it progressed.
        onProgress: () => emit({ type: "progress", message: "Provider sign-in is in progress." }),
        onPrompt: () => refuse("an answer"),
        onBrowserSession: () => refuse("a browser session"),
        onManualCodeInput:
            method.interaction === "browser-callback"
                ? undefined
                : () => refuse("a pasted authorization code"),
        signal,
    };
}

/** Rejects when the attempt ends, so an unresponsive provider cannot hold the process open. */
function ended(signal: AbortSignal, deadline: AbortSignal, method: string): Promise<never> {
    const { promise, reject } = Promise.withResolvers<never>();
    const stop = () =>
        reject(
            deadline.aborted
                ? new LoginError("TIMED_OUT", `${method} was not authorized before the deadline.`)
                : new LoginError("CANCELLED", `${method} was stopped before it finished.`),
        );
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    return promise;
}

function loginFailure(
    failure: unknown,
    method: string,
    provider: string,
    refusals: { asked: boolean },
    signal: AbortSignal,
    deadline: AbortSignal,
): unknown {
    const details: Record<string, unknown> = { method, provider };
    if (refusals.asked) {
        return new LoginError(
            "FAILED_PRECONDITION",
            `${method} needs an answer Pico does not give, so nothing was stored.`,
            details,
        );
    }
    if (failure instanceof LoginError) return failure;
    if (failure instanceof CredentialError) return failure;
    if (deadline.aborted) {
        return new LoginError(
            "TIMED_OUT",
            `${method} was not authorized before the deadline.`,
            details,
        );
    }
    if (signal.aborted) {
        return new LoginError("CANCELLED", `${method} was stopped before it finished.`, details);
    }
    const oauth = asOAuthError(failure);
    if (oauth) {
        if (oauth.status !== undefined) details.status = oauth.status;
        details.kind = oauth.kind;
        return new LoginError(
            codeOfOAuthKind(oauth.kind),
            `The provider sign-in failed during ${oauth.kind}.`,
            details,
        );
    }
    return new LoginError(
        "UNAVAILABLE",
        "The provider sign-in failed. Inspect pico credentials list if completion was interrupted.",
        details,
    );
}

/** The engine's own classification of where a login failed, kept as the safe detail. */
function codeOfOAuthKind(kind: string): LoginErrorCode {
    if (kind === "device-auth") return "AUTH_REQUIRED";
    if (kind === "timeout") return "TIMED_OUT";
    if (kind === "configuration" || kind === "entitlement") return "FAILED_PRECONDITION";
    return "UNAVAILABLE";
}

const OAUTH_ERROR_KINDS: Record<OAuthErrorKind, true> = {
    http: true,
    validation: true,
    "token-exchange": true,
    "token-refresh": true,
    polling: true,
    timeout: true,
    "device-auth": true,
    configuration: true,
    provisioning: true,
    entitlement: true,
    discovery: true,
};

function asOAuthError(failure: unknown): { kind: string; status: number | undefined } | undefined {
    if (!(failure instanceof Error) || failure.name !== "OAuthError") return undefined;
    const oauth = failure as Error & { kind?: string; status?: unknown };
    const kind =
        typeof oauth.kind === "string" && Object.hasOwn(OAUTH_ERROR_KINDS, oauth.kind)
            ? oauth.kind
            : "http";
    const status =
        typeof oauth.status === "number" &&
        Number.isInteger(oauth.status) &&
        oauth.status >= 100 &&
        oauth.status <= 599
            ? oauth.status
            : undefined;
    return { kind, status };
}

function apiKeyResult(provider: string): LoginError {
    return new LoginError(
        "FAILED_PRECONDITION",
        `This method only takes a key you already hold; store it with pico credentials create --provider ${provider} --stdin.`,
        { provider },
    );
}

function noCredential(
    method: string,
    provider: string,
    rows: readonly { provider: string; credential: AuthCredential }[],
): LoginError {
    return new LoginError(
        "INTERNAL",
        `${method} finished without storing a credential for ${provider}.`,
        { method, provider, stored: rows.map(row => row.provider) },
    );
}
