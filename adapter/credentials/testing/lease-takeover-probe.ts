import { Database } from "bun:sqlite";

import { credentialIndexPath } from "../coordination.ts";
import { RefreshLeases } from "../index-leases.ts";

/**
 * A hostile peer: it waits for nothing. With `busy_timeout = 0` its write
 * transaction fails immediately when another process holds the index, so a test
 * can tell whether a fenced save really spans the lock or only touches it.
 *
 * Prints one of `blocked`, `took-lease` or `lease-held`, and exits 0 either way:
 * being shut out is the expected outcome, not a failure.
 *
 * Usage: `bun lease-takeover-probe.ts <dataDir> <credentialId> <owner> <nowMs>`
 */
const [dataDir, credentialId, owner, nowMs] = process.argv.slice(2);
if (!dataDir || !credentialId || !owner || !nowMs) {
    throw new Error("lease-takeover-probe needs four arguments");
}

const database = new Database(credentialIndexPath(dataDir), { readwrite: true });
database.run("PRAGMA busy_timeout = 0");
try {
    database.run("BEGIN IMMEDIATE");
} catch {
    process.stdout.write("blocked");
    process.exit(0);
}

const now = Number(nowMs);
const took = new RefreshLeases(database).acquire(Number(credentialId), owner, now + 10_000, now);
database.run("COMMIT");
process.stdout.write(took ? "took-lease" : "lease-held");
