// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-mode.ts (MIT; see THIRD-PARTY-NOTICES.md).

import { homedir } from "node:os";
import { join } from "node:path";

import manifest from "../package.json" with { type: "json" };
import { DataDirError, ensureDataDir, ensureDataFile, picoDataDir } from "./data-dir.ts";
import { isolateStdout } from "./stdout-isolation.ts";

// First statement of the program: everything imported below may print, and the
// dynamic imports keep OMP from loading before stdout belongs to the protocol.
const protocolStdout = isolateStdout();

const dataDir = picoDataDir(homedir());
try {
    ensureDataDir(dataDir);
    // Oh My Pi opens the cache only once a session starts, and ignores a failure there.
    ensureDataFile(join(dataDir, "models.db"));
} catch (error) {
    if (!(error instanceof DataDirError)) throw error;
    console.error(`pico: ${error.message}`);
    process.exit(1);
}

const { ndJsonStream } = await import("@agentclientprotocol/sdk");
const { createPicoAgent, picoAgentShutdown } = await import("./server/pico-agent.ts");
const { createPicoSession } = await import("./engine/pico-session.ts");

/** How long shutdown may take before Pico reports an unclean exit. */
const SHUTDOWN_GRACE_MS = 5_000;

const app = createPicoAgent({
    version: manifest.version,
    createSession: (cwd, mcpServers) => createPicoSession({ cwd, mcpServers, dataDir }),
});

const connection = app.connect(ndJsonStream(protocolStdout, Bun.stdin.stream()));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => connection.close());
}

await connection.closed;

const shutdown = picoAgentShutdown(app);
const expiry = Promise.withResolvers<false>();
const timer = setTimeout(() => expiry.resolve(false), SHUTDOWN_GRACE_MS);
const disposed = await Promise.race([shutdown.completed.then(() => true), expiry.promise]);
clearTimeout(timer);

if (!disposed) {
    const steps = shutdown.outstanding();
    const detail =
        steps.length > 0 ? `still ${steps.join("; still ")}` : "no step reported it was running";
    console.error(`pico: shutdown did not finish within ${SHUTDOWN_GRACE_MS}ms; ${detail}`);
}
process.exit(disposed ? 0 : 1);
