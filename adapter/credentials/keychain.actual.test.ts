// The real bridge against the real login Keychain. Every item lives under a service name
// generated for this run, so no Pico credential and no other account can be observed or
// changed, and `afterAll` proves the run left nothing behind.
//
// `mise run keychain:verify` is the only thing that sets PICO_KEYCHAIN_INTEGRATION: the
// ordinary gate must never write to a developer's or a runner's Keychain.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createKeychain, type SecretStore } from "./keychain.ts";

const INTEGRATION = process.platform === "darwin" && process.env.PICO_KEYCHAIN_INTEGRATION === "1";

/** This run's synthetic service, and a second one that proves services are separate. */
const SERVICE = `me.malstrom.pico.test.${randomUUID()}`;
const OTHER_SERVICE = `me.malstrom.pico.test.${randomUUID()}`;

/** A credential payload shaped like the vault's: opaque UTF-8 JSON to this layer. */
function payload(reference: string, token: string): string {
    return JSON.stringify({ version: 1, reference, provider: "example", kind: "api_key", token });
}

describe.skipIf(!INTEGRATION)("proposal.0009 the real Keychain bridge", () => {
    // Created in `beforeAll`, so a skipped run leaves no temporary directory behind.
    let dataDir = "";
    let store!: SecretStore;
    let other!: SecretStore;
    const written: { reference: string; owner: SecretStore }[] = [];

    beforeAll(() => {
        dataDir = realpathSync(mkdtempSync(join(tmpdir(), "pico-keychain-actual-")));
        store = createKeychain({ service: SERVICE, dataDir });
        other = createKeychain({ service: OTHER_SERVICE, dataDir });
    });

    /** A fresh credential reference, remembered so the run can prove it removed it. */
    function reference(owner: SecretStore): string {
        const value = randomUUID();
        written.push({ reference: value, owner });
        return value;
    }

    afterAll(() => {
        const left: string[] = [];
        for (const { reference: value, owner } of written) {
            try {
                owner.delete(value);
                if (owner.get(value) !== null) left.push(value);
            } catch {
                left.push(`${owner === store ? SERVICE : OTHER_SERVICE}/${value}`);
            }
        }
        rmSync(dataDir, { recursive: true, force: true });
        expect(left).toEqual([]);
    });

    test("a reference that was never stored reads as missing rather than failing", () => {
        expect(store.get(reference(store))).toBeNull();
    });

    test("deleting a reference that is not there reports nothing to delete, so a retry finishes", () => {
        expect(store.delete(reference(store))).toBe(false);
    });

    test("a stored payload reads back byte for byte", () => {
        const value = reference(store);
        const stored = payload(value, 'ключ-🔑-"quoted"-\\escaped');

        store.set(value, stored);

        expect(store.get(value)).toBe(stored);
    });

    test("storing the same reference again replaces the payload instead of adding a second item", () => {
        const value = reference(store);
        store.set(value, payload(value, "first"));

        store.set(value, payload(value, "second"));

        expect(store.get(value)).toBe(payload(value, "second"));
        expect(store.delete(value)).toBe(true);
        expect(store.get(value)).toBeNull();
    });

    test("a deleted reference is gone, and deleting it again still reports nothing to delete", () => {
        const value = reference(store);
        store.set(value, payload(value, "deleted"));

        expect(store.delete(value)).toBe(true);
        expect(store.get(value)).toBeNull();
        expect(store.delete(value)).toBe(false);
    });

    test("a refresh-sized payload round trips", () => {
        const value = reference(store);
        const stored = payload(value, "r".repeat(64 * 1024));

        store.set(value, stored);

        expect(store.get(value)).toBe(stored);
    });

    test("the same reference under another service is a different item", () => {
        const value = reference(store);
        written.push({ reference: value, owner: other });
        store.set(value, payload(value, "mine"));
        other.set(value, payload(value, "theirs"));

        expect(store.get(value)).toBe(payload(value, "mine"));
        expect(other.get(value)).toBe(payload(value, "theirs"));

        expect(store.delete(value)).toBe(true);
        expect(other.get(value)).toBe(payload(value, "theirs"));
    });

    test("another process reads what set() had already persisted when it returned", () => {
        const value = reference(store);
        const stored = payload(value, "durable");
        store.set(value, stored);

        const read = Bun.spawnSync({
            cmd: [
                process.execPath,
                "-e",
                `import { createKeychain } from ${JSON.stringify(join(import.meta.dir, "keychain.ts"))};
                 const store = createKeychain({ service: process.env.PICO_TEST_SERVICE });
                 process.stdout.write(store.get(process.env.PICO_TEST_REFERENCE) ?? "<missing>");`,
            ],
            env: { ...process.env, PICO_TEST_SERVICE: SERVICE, PICO_TEST_REFERENCE: value },
            stdout: "pipe",
            stderr: "pipe",
        });

        expect(read.stderr.toString()).toBe("");
        expect(read.stdout.toString()).toBe(stored);
        expect(read.exitCode).toBe(0);
    });

    test("a missing default Keychain fails without waiting for a reset dialog", () => {
        const value = reference(store);
        const missingHome = join(dataDir, "home-without-keychain");
        mkdirSync(missingHome);
        const child = Bun.spawnSync({
            cmd: [
                process.execPath,
                "-e",
                `import { createKeychain } from ${JSON.stringify(join(import.meta.dir, "keychain.ts"))};
                 const store = createKeychain({ service: process.env.PICO_TEST_SERVICE });
                 try {
                     store.set(process.env.PICO_TEST_REFERENCE, "FAKE-no-ui-regression");
                     process.stdout.write(JSON.stringify({stored:true}));
                 } catch (error) {
                     process.stdout.write(JSON.stringify({code:error.code,status:error.status}));
                 }`,
            ],
            env: {
                HOME: missingHome,
                PATH: "/usr/bin:/bin",
                PICO_TEST_SERVICE: SERVICE,
                PICO_TEST_REFERENCE: value,
            },
            timeout: 3_000,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(child.exitCode).toBe(0);
        expect(child.stderr.toString()).toBe("");
        expect(JSON.parse(child.stdout.toString()).code).toBe("KEYCHAIN_UI_REQUIRED");
    });
});
