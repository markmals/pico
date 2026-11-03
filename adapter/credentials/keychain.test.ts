import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createKeychain, KeychainError, type SecretStore } from "./keychain.ts";

/**
 * A service no Pico installation ever writes to. Nothing in this file is expected to reach
 * the Keychain at all; if a change ever made it, it would still miss every real item.
 */
const SERVICE = "me.malstrom.pico.test.loading";

/** The bridge the development launcher loads, which a checkout only has once it is built. */
const BUILT_ADDON = join(import.meta.dir, "..", "..", ".build", "keychain", "pico_keychain.node");

const roots: string[] = [];

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-keychain-")));
    roots.push(root);
    return root;
}

/** A data directory that does not exist yet, so creating one is observable. */
function unusedDataDir(): string {
    return join(temporaryRoot(), "Pico");
}

function failureOf(action: () => unknown): KeychainError {
    try {
        action();
    } catch (error) {
        if (error instanceof KeychainError) return error;
        throw error;
    }
    throw new Error("the operation was expected to fail");
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 the Keychain bridge's loading boundary", () => {
    test("a store touches no file and loads no addon until its first operation", () => {
        const dataDir = unusedDataDir();

        createKeychain({ service: SERVICE, dataDir });

        expect(existsSync(dataDir)).toBe(false);
    });

    test("an empty reference is refused before any native work", () => {
        const dataDir = unusedDataDir();
        const store: SecretStore = createKeychain({ service: SERVICE, dataDir });

        expect(() => store.get("")).toThrow(TypeError);
        expect(() => store.set("", "{}")).toThrow(TypeError);
        expect(() => store.delete("")).toThrow(TypeError);
        expect(existsSync(dataDir)).toBe(false);
    });

    test("a reference carrying a NUL is refused, so no truncated account can be addressed", () => {
        const dataDir = unusedDataDir();
        const store = createKeychain({ service: SERVICE, dataDir });

        expect(() => store.get("3f1c\u0000injected")).toThrow(TypeError);
        expect(() => store.set("3f1c\u0000injected", "{}")).toThrow(TypeError);
        expect(() => store.delete("3f1c\u0000injected")).toThrow(TypeError);
        expect(existsSync(dataDir)).toBe(false);
    });

    test("an empty service is refused when the store is created", () => {
        expect(() => createKeychain({ service: "" })).toThrow(TypeError);
    });

    test.skipIf(process.platform === "darwin")(
        "off macOS every credential operation reports the platform prerequisite and extracts nothing",
        () => {
            const dataDir = unusedDataDir();
            const store = createKeychain({ service: SERVICE, dataDir });

            for (const operation of [
                () => store.get("5a2a1d64-6f1a-4a0e-9a3c-0b0b2f0b1c77"),
                () => store.set("5a2a1d64-6f1a-4a0e-9a3c-0b0b2f0b1c77", "{}"),
                () => store.delete("5a2a1d64-6f1a-4a0e-9a3c-0b0b2f0b1c77"),
            ]) {
                expect(failureOf(operation).code).toBe("KEYCHAIN_UNSUPPORTED_PLATFORM");
            }
            expect(existsSync(dataDir)).toBe(false);
        },
    );

    test.skipIf(process.platform !== "darwin" || existsSync(BUILT_ADDON))(
        "a checkout whose bridge is not compiled yet names the task that compiles it",
        () => {
            const store = createKeychain({ service: SERVICE, dataDir: unusedDataDir() });

            const failure = failureOf(() => store.get("5a2a1d64-6f1a-4a0e-9a3c-0b0b2f0b1c77"));

            expect(failure.code).toBe("KEYCHAIN_UNAVAILABLE");
            expect(failure.message).toContain("mise run keychain:build");
        },
    );
});
