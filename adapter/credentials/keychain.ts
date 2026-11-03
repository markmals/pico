import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeAtomically } from "../atomic-write.ts";
import { ensureDataDir, picoDataDir } from "../data-dir.ts";

/** The service every Pico credential item lives under in the user's login Keychain. */
export const DEFAULT_KEYCHAIN_SERVICE = "me.malstrom.pico.credentials";

const ADDON_FILENAME = "pico_keychain.node";

/** What `mise run keychain:build` writes; the development launcher loads it from here. */
const BUILT_ADDON = join(import.meta.dir, "..", "..", ".build", "keychain", ADDON_FILENAME);

/**
 * One credential's stored bytes, addressed by its Pico reference.
 *
 * Every method is synchronous because Oh My Pi's credential store commits synchronously: a
 * write that is merely queued when the commit returns is not persistence.
 */
export interface SecretStore {
    /** The stored payload, or null when there is no such item — never when access failed. */
    get(reference: string): string | null;
    /** Stores or replaces the item, durable before returning. */
    set(reference: string, payload: string): void;
    /** True when an item was removed, false when there was none, so a retry can finish. */
    delete(reference: string): boolean;
    /** The same items with permission dialogs forbidden, for fenced SDK writes. */
    withoutInteraction(): SecretStore;
}

export interface KeychainOptions {
    /** Defaults to {@link DEFAULT_KEYCHAIN_SERVICE}; tests pass a synthetic service. */
    service?: string;
    /** Lets the OS ask the human for permission instead of failing without a dialog. */
    allowKeychainUI?: boolean;
    /** Where the compiled executable extracts its carried addon; unused when running sources. */
    dataDir?: string;
}

export type KeychainOperation = "get" | "set" | "delete" | "load";

export type KeychainErrorCode =
    /** The OS would have had to ask the human, and this call did not permit a dialog. */
    | "KEYCHAIN_UI_REQUIRED"
    /** The Keychain itself is unusable: missing, invalid or unavailable. */
    | "KEYCHAIN_LOCKED"
    /** Security refused the access: authorization failed, was cancelled, or is not granted. */
    | "KEYCHAIN_ACCESS_DENIED"
    /** Any other Security failure; {@link KeychainError.status} always names its OSStatus. */
    | "KEYCHAIN_FAILED"
    /** The bridge could not be built, extracted or loaded, so no Keychain call happened. */
    | "KEYCHAIN_UNAVAILABLE"
    /** Keychain is a macOS store, and this is not macOS. */
    | "KEYCHAIN_UNSUPPORTED_PLATFORM";

interface KeychainFailure {
    readonly code: KeychainErrorCode;
    readonly operation: KeychainOperation;
    readonly message: string;
    /** The OSStatus Security returned, when the failure came from a Security call. */
    readonly status?: number;
    readonly cause?: unknown;
}

/** A Keychain failure. Its message names the operation and its status, never the payload. */
export class KeychainError extends Error {
    readonly code: KeychainErrorCode;
    readonly operation: KeychainOperation;
    readonly status: number | undefined;

    constructor(failure: KeychainFailure) {
        super(failure.message, { cause: failure.cause });
        this.name = "KeychainError";
        this.code = failure.code;
        this.operation = failure.operation;
        this.status = failure.status;
    }
}

/** What the addon exports: the Keychain item's service and account are explicit arguments. */
interface KeychainBridge {
    get(service: string, account: string, allowUI: boolean): string | null;
    set(service: string, account: string, payload: string, allowUI: boolean): void;
    delete(service: string, account: string, allowUI: boolean): boolean;
}

/** Addons already loaded in this process, by the path they were loaded from. */
const bridges = new Map<string, KeychainBridge>();

/** Where each data directory's addon ended up, so an operation re-reads nothing. */
const addonPaths = new Map<string, string>();

/**
 * A store over the login Keychain. Nothing is read, extracted or loaded until the first
 * operation, so discovery, previews and `--help` stay free of native code.
 */
export function createKeychain(options: KeychainOptions = {}): SecretStore {
    const service = options.service ?? DEFAULT_KEYCHAIN_SERVICE;
    if (service === "") throw new TypeError("a keychain service cannot be empty");
    const allowUI = options.allowKeychainUI ?? false;
    const dataDir = options.dataDir ?? picoDataDir(homedir());

    let noninteractive: SecretStore | undefined;
    const store: SecretStore = {
        get(reference) {
            checkReference(reference);
            const bridge = loadBridge(dataDir);
            return attempt("get", () => bridge.get(service, reference, allowUI));
        },
        set(reference, payload) {
            checkReference(reference);
            const bridge = loadBridge(dataDir);
            attempt("set", () => bridge.set(service, reference, payload, allowUI));
        },
        delete(reference) {
            checkReference(reference);
            const bridge = loadBridge(dataDir);
            return attempt("delete", () => bridge.delete(service, reference, allowUI));
        },
        withoutInteraction() {
            if (!allowUI) return store;
            noninteractive ??= createKeychain({ service, dataDir, allowKeychainUI: false });
            return noninteractive;
        },
    };
    return store;
}

/**
 * A reference is an item's account, which C strings would silently truncate at a NUL, so a
 * reference containing one could address an item its caller did not name.
 */
function checkReference(reference: string): void {
    if (reference === "") throw new TypeError("a credential reference cannot be empty");
    if (reference.includes("\u0000")) {
        throw new TypeError("a credential reference cannot contain a NUL");
    }
}

/** Turns whatever the addon threw into a {@link KeychainError} naming the operation. */
function attempt<T>(operation: KeychainOperation, action: () => T): T {
    try {
        return action();
    } catch (error) {
        if (error instanceof KeychainError) throw error;
        const thrown = error as { code?: unknown; status?: unknown; message?: unknown };
        const code = nativeCode(thrown.code);
        throw new KeychainError({
            code,
            operation,
            status: typeof thrown.status === "number" ? thrown.status : undefined,
            message:
                typeof thrown.message === "string" && thrown.message !== ""
                    ? thrown.message
                    : `keychain ${operation} failed`,
            cause: error,
        });
    }
}

const NATIVE_CODES: readonly KeychainErrorCode[] = [
    "KEYCHAIN_UI_REQUIRED",
    "KEYCHAIN_LOCKED",
    "KEYCHAIN_ACCESS_DENIED",
    "KEYCHAIN_FAILED",
];

function nativeCode(code: unknown): KeychainErrorCode {
    const named = NATIVE_CODES.find(candidate => candidate === code);
    return named ?? "KEYCHAIN_FAILED";
}

function loadBridge(dataDir: string): KeychainBridge {
    if (process.platform !== "darwin") {
        throw new KeychainError({
            code: "KEYCHAIN_UNSUPPORTED_PLATFORM",
            operation: "load",
            message: `pico stores credentials in the macOS Keychain, which ${process.platform} does not have`,
        });
    }

    let path = addonPaths.get(dataDir);
    if (path === undefined) {
        path = process.env.PI_COMPILED === "true" ? installCarriedAddon(dataDir) : builtAddon();
        addonPaths.set(dataDir, path);
    }
    return openAddon(path);
}

/** The addon a checkout builds, which the development launcher runs against. */
function builtAddon(): string {
    if (existsSync(BUILT_ADDON)) return BUILT_ADDON;
    throw new KeychainError({
        code: "KEYCHAIN_UNAVAILABLE",
        operation: "load",
        message: `pico's keychain bridge is not compiled: run \`mise run keychain:build\` to write ${BUILT_ADDON}`,
    });
}

/**
 * Writes the carried addon into the private data directory, because a `/$bunfs` path cannot be
 * loaded. The bytes are compared rather than the size, so a truncated or tampered extraction is
 * replaced instead of loaded, and the file stays readable by its owner alone.
 */
function installCarriedAddon(dataDir: string): string {
    const directory = join(dataDir, "keychain");
    const target = join(directory, ADDON_FILENAME);
    try {
        ensureDataDir(dataDir);
        mkdirSync(directory, { recursive: true });
        chmodSync(directory, 0o700);
        const carried = readFileSync(carriedAddonPath());
        if (!matches(target, carried)) writeAtomically(target, carried, 0o700);
    } catch (error) {
        throw new KeychainError({
            code: "KEYCHAIN_UNAVAILABLE",
            operation: "load",
            message: `cannot extract pico's keychain bridge to ${target}: ${reason(error)}`,
            cause: error,
        });
    }
    return target;
}

/**
 * The `/$bunfs` path of the addon the executable carries.
 *
 * `require` because {@link SecretStore} is synchronous; the bundler resolves this literal
 * specifier into the executable. Only a compiled build ever evaluates it: Bun's runtime
 * refuses to import a `.node` file, even `with { type: "file" }`.
 */
function carriedAddonPath(): string {
    const carried = require("./carried-keychain.ts") as { default?: unknown } | string;
    const path = typeof carried === "string" ? carried : carried.default;
    if (typeof path !== "string" || path === "") {
        throw new KeychainError({
            code: "KEYCHAIN_UNAVAILABLE",
            operation: "load",
            message: "this build of pico carries no keychain bridge",
        });
    }
    return path;
}

function matches(target: string, content: Uint8Array): boolean {
    try {
        return readFileSync(target).equals(content);
    } catch {
        return false;
    }
}

function openAddon(path: string): KeychainBridge {
    const loaded = bridges.get(path);
    if (loaded !== undefined) return loaded;

    const addon: { exports: unknown } = { exports: {} };
    try {
        process.dlopen(addon, path);
    } catch (error) {
        throw new KeychainError({
            code: "KEYCHAIN_UNAVAILABLE",
            operation: "load",
            message: `cannot load pico's keychain bridge at ${path}: ${reason(error)}`,
            cause: error,
        });
    }

    const exported = addon.exports as Partial<KeychainBridge>;
    if (
        typeof exported.get !== "function" ||
        typeof exported.set !== "function" ||
        typeof exported.delete !== "function"
    ) {
        throw new KeychainError({
            code: "KEYCHAIN_UNAVAILABLE",
            operation: "load",
            message: `${path} is not pico's keychain bridge`,
        });
    }

    const bridge = exported as KeychainBridge;
    bridges.set(path, bridge);
    return bridge;
}

function reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
