import type { SecretStore } from "../keychain.ts";

/** How a native Keychain failure reaches the vault: a coded error, never a payload. */
export function keychainFailure(
    code: string,
    operation: "get" | "set" | "delete",
    status?: number,
): Error {
    const error = new Error(`keychain ${operation} failed (${code})`);
    return Object.assign(error, { name: "KeychainError", code, operation, status });
}

/** Which view of the store an operation went through. */
export type SecretStoreView = "interactive" | "noninteractive";

export interface MemorySecretStore extends SecretStore {
    /** The stored payloads, so a test can corrupt or remove one the way a human would. */
    readonly items: Map<string, string>;
    /** Fails the next call to `operation` with `error`, once, through either view. */
    failNext(operation: "get" | "set" | "delete", error: Error): void;
    /** References passed to each operation, oldest first. */
    readonly reads: string[];
    readonly writes: string[];
    readonly deletes: string[];
    /** The view each operation was made through, in the same order. */
    readonly views: SecretStoreView[];
    readonly view: SecretStoreView;
    withoutInteraction(): MemorySecretStore;
}

interface SharedState {
    items: Map<string, string>;
    pending: Map<string, Error>;
    reads: string[];
    writes: string[];
    deletes: string[];
    views: SecretStoreView[];
}

/**
 * The isolated SecretStore tests inject through `openCredentialVault({ keychain })`.
 * Production never constructs it: a missing native bridge is a failure, not a fallback.
 *
 * Its noninteractive view shares every byte of state with the interactive one — an
 * in-memory store can never raise a dialog — but it is a distinct object, so a test
 * can prove which view a caller used.
 */
export function createMemorySecretStore(): MemorySecretStore {
    const shared: SharedState = {
        items: new Map(),
        pending: new Map(),
        reads: [],
        writes: [],
        deletes: [],
        views: [],
    };
    return viewOf(shared, "interactive");
}

function viewOf(shared: SharedState, view: SecretStoreView): MemorySecretStore {
    let noninteractive: MemorySecretStore | undefined;

    function record(operation: string, reference: string, log: string[]): void {
        log.push(reference);
        shared.views.push(view);
        const failure = shared.pending.get(operation);
        if (!failure) return;
        shared.pending.delete(operation);
        throw failure;
    }

    const store: MemorySecretStore = {
        items: shared.items,
        reads: shared.reads,
        writes: shared.writes,
        deletes: shared.deletes,
        views: shared.views,
        view,
        failNext(operation, error) {
            shared.pending.set(operation, error);
        },
        withoutInteraction() {
            if (view === "noninteractive") return store;
            noninteractive ??= viewOf(shared, "noninteractive");
            return noninteractive;
        },
        get(reference) {
            record("get", reference, shared.reads);
            return shared.items.get(reference) ?? null;
        },
        set(reference, payload) {
            record("set", reference, shared.writes);
            shared.items.set(reference, payload);
        },
        delete(reference) {
            record("delete", reference, shared.deletes);
            return shared.items.delete(reference);
        },
    };
    return store;
}
