import { appendFileSync, existsSync } from "node:fs";

import { withCredentialLock } from "../coordination.ts";

/**
 * Takes the credential lock in its own process and records when it attempted,
 * held and released it, so a test can prove a second process waited rather than
 * interleaving. Holding until a sentinel file appears keeps the handover driven
 * by the test rather than by a guessed duration.
 *
 * Usage: `bun lock-probe.ts <dataDir> <logPath> <label> [releaseSentinel]`
 */
const [dataDir, logPath, label, releaseSentinel] = process.argv.slice(2);
if (!dataDir || !logPath || !label) throw new Error("lock-probe needs at least three arguments");

appendFileSync(logPath, `${label}-attempting\n`);
withCredentialLock(dataDir, () => {
    appendFileSync(logPath, `${label}-acquired\n`);
    // The lock is synchronous by contract, so the only way to hold it across the
    // test's next step is to block this thread until the sentinel lands.
    while (releaseSentinel && !existsSync(releaseSentinel)) Bun.sleepSync(5);
    appendFileSync(logPath, `${label}-released\n`);
});
