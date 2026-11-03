import type { AuthCredentialStore, OAuthCredential } from "@oh-my-pi/pi-ai";

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MemorySecretStore } from "./testing/memory-secret-store.ts";

import { createKeychainCredentialStore, serializedCredentialData } from "./auth-storage.ts";
import { createMemorySecretStore } from "./testing/memory-secret-store.ts";
import { openCredentialVault } from "./vault.ts";

const PROVIDER = "anthropic";

const TAKEOVER_PROBE = join(import.meta.dir, "testing", "lease-takeover-probe.ts");

const grant = (access: string): OAuthCredential => ({
    type: "oauth",
    access,
    refresh: `refresh-for-${access}`,
    expires: 4_000_000_000_000,
    accountId: "account-1",
});

const roots: string[] = [];

function temporaryDataDir(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-refresh-lease-")));
    roots.push(root);
    return join(root, "Pico");
}

interface Fixture {
    dataDir: string;
    keychain: MemorySecretStore;
    store: AuthCredentialStore;
    rowId: number;
    close(): void;
}

function fixture(): Fixture {
    const dataDir = temporaryDataDir();
    const keychain = createMemorySecretStore();
    const vault = openCredentialVault({ dataDir, keychain });
    const stored = vault.create(PROVIDER, grant("access-0"));
    const { rowId } = vault.read(stored.reference);
    const store = createKeychainCredentialStore({ dataDir, keychain });
    return {
        dataDir,
        keychain,
        store,
        rowId,
        close() {
            store.close();
            vault.close();
        },
    };
}

/** A 32-bit xorshift, deterministic per seed, as in the other property tests. */
function randomSource(seed: number): (bound: number) => number {
    let state = seed >>> 0 || 0x9e37_79b9;
    return bound => {
        state = (state ^ (state << 13)) >>> 0;
        state = state ^ (state >>> 17);
        state = (state ^ (state << 5)) >>> 0;
        return state % bound;
    };
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 durable refresh leases", () => {
    test("one owner holds the lease until it expires", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();

        expect(store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now + 10_000)).toBe(true);
        expect(store.tryAcquireCredentialRefreshLease?.(rowId, "owner-b", now + 10_000)).toBe(
            false,
        );
        expect(store.getCredentialRefreshLeaseExpiresAt?.(rowId)).toBe(now + 10_000);
        close();
    });

    test("a lapsed lease can be taken over, and still names its last holder", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now - 1);

        expect(store.getCredentialRefreshLeaseHolder?.(rowId)).toEqual({
            owner: "owner-a",
            expiresAtMs: now - 1,
        });
        expect(store.tryAcquireCredentialRefreshLease?.(rowId, "owner-b", now + 10_000)).toBe(true);
        expect(store.getCredentialRefreshLeaseHolder?.(rowId)?.owner).toBe("owner-b");
        close();
    });

    test("only the holder renews or releases", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now + 10_000);

        expect(store.renewCredentialRefreshLease?.(rowId, "owner-b", now + 20_000)).toBe(false);
        expect(store.renewCredentialRefreshLease?.(rowId, "owner-a", now + 20_000)).toBe(true);

        store.releaseCredentialRefreshLease?.(rowId, "owner-b");
        expect(store.getCredentialRefreshLeaseHolder?.(rowId)?.owner).toBe("owner-a");

        store.releaseCredentialRefreshLease?.(rowId, "owner-a");
        expect(store.getCredentialRefreshLeaseHolder?.(rowId)).toBeUndefined();
        close();
    });

    test("a taken-over lease can be handed back to the holder it replaced", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "stalled", now - 1);
        store.tryAcquireCredentialRefreshLease?.(rowId, "taker", now + 10_000);

        const handedBack = store.handBackCredentialRefreshLease?.(rowId, "taker", {
            owner: "stalled",
            expiresAtMs: now + 5_000,
        });

        expect(handedBack).toBe(true);
        expect(store.getCredentialRefreshLeaseHolder?.(rowId)).toEqual({
            owner: "stalled",
            expiresAtMs: now + 5_000,
        });
        expect(
            store.handBackCredentialRefreshLease?.(rowId, "taker", {
                owner: "someone-else",
                expiresAtMs: now + 5_000,
            }),
        ).toBe(false);
        close();
    });

    test("a lease outlives the process that took it", () => {
        const { dataDir, keychain, store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now + 10_000);
        store.close();

        const reopened = createKeychainCredentialStore({ dataDir, keychain });
        expect(reopened.tryAcquireCredentialRefreshLease?.(rowId, "owner-b", now + 10_000)).toBe(
            false,
        );
        expect(reopened.getCredentialRefreshLeaseHolder?.(rowId)?.owner).toBe("owner-a");
        reopened.close();
        close();
    });

    test("a process that lost the lease cannot publish its exchanged token", () => {
        const { store, keychain, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "winner", now + 10_000);
        const payloadBefore = [...keychain.items.values()][0];

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(grant("access-0")) ?? "",
            grant("loser-access"),
            { owner: "loser", nowMs: now },
        );

        expect(saved).toBe(false);
        expect([...keychain.items.values()][0]).toBe(payloadBefore);
        close();
    });

    test("a lease that expired at the moment of the save cannot publish", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now + 1_000);

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(grant("access-0")) ?? "",
            grant("too-late"),
            { owner: "owner-a", nowMs: now + 2_000 },
        );

        expect(saved).toBe(false);
        close();
    });

    test("the lease holder publishes its exchanged token", () => {
        const { store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "owner-a", now + 10_000);

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(grant("access-0")) ?? "",
            grant("access-1"),
            { owner: "owner-a", nowMs: now },
        );

        expect(saved).toBe(true);
        expect(store.listAuthCredentials(PROVIDER)[0]?.credential).toMatchObject({
            type: "oauth",
            access: "access-1",
        });
        close();
    });

    test("interleaved refreshers never overwrite a newer grant", () => {
        const { store, rowId, close } = fixture();
        const random = randomSource(0x5eed_1234);
        const owners = ["alpha", "beta", "gamma"];
        const now = Date.now();
        let published = "access-0";
        let minted = 0;
        // What each owner believes the stored grant was when it started exchanging.
        const believed = new Map<string, string>();

        for (let step = 0; step < 400; step += 1) {
            const owner = owners[random(owners.length)]!;
            const action = random(4);
            if (action === 0) {
                store.tryAcquireCredentialRefreshLease?.(rowId, owner, now + 10_000);
                believed.set(owner, published);
                continue;
            }
            if (action === 1) {
                store.releaseCredentialRefreshLease?.(rowId, owner);
                continue;
            }
            if (action === 2) {
                believed.set(owner, published);
                continue;
            }
            const expected = believed.get(owner) ?? "access-0";
            minted += 1;
            const candidate = `access-${minted}`;
            const holder = store.getCredentialRefreshLeaseHolder?.(rowId);
            const fenced = holder?.owner === owner && holder.expiresAtMs > now;
            const saved = store.tryUpdateAuthCredentialIfMatches?.(
                rowId,
                serializedCredentialData(grant(expected)) ?? "",
                grant(candidate),
                { owner, nowMs: now },
            );

            expect(saved).toBe(fenced && expected === published);
            if (saved) published = candidate;
            expect(store.listAuthCredentials(PROVIDER)[0]?.credential).toMatchObject({
                type: "oauth",
                access: published,
            });
        }

        close();
    });

    test("a peer cannot take the lapsed lease while a fenced save is in flight", () => {
        const { dataDir, keychain, store, rowId, close } = fixture();
        const now = Date.now();
        store.tryAcquireCredentialRefreshLease?.(rowId, "writer", now + 60_000);
        let peerOutcome = "not-run";
        // The SDK store writes through the noninteractive view, so that is the call
        // the peer has to race.
        const noninteractive = keychain.withoutInteraction();
        const write = noninteractive.set.bind(noninteractive);
        noninteractive.set = (reference, payload) => {
            // A peer that waits for nothing, reading a clock where this lease has
            // lapsed: the only thing that can keep it out is the index lock itself.
            const probe = Bun.spawnSync([
                process.execPath,
                TAKEOVER_PROBE,
                dataDir,
                String(rowId),
                "peer",
                String(now + 120_000),
            ]);
            peerOutcome = probe.stdout.toString();
            write(reference, payload);
        };

        const saved = store.tryUpdateAuthCredentialIfMatches?.(
            rowId,
            serializedCredentialData(grant("access-0")) ?? "",
            grant("writer-access"),
            { owner: "writer", nowMs: now },
        );

        expect(peerOutcome).toBe("blocked");
        expect(saved).toBe(true);
        expect(store.getCredentialRefreshLeaseHolder?.(rowId)?.owner).toBe("writer");
        expect(store.listAuthCredentials(PROVIDER)[0]?.credential).toMatchObject({
            type: "oauth",
            access: "writer-access",
        });
        close();
    });
});
