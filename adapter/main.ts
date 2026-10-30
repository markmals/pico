// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-mode.ts (MIT; see THIRD-PARTY-NOTICES.md).

import { isolateStdout } from "./stdout-isolation.ts";

// First statement of the program: everything imported below may print, and the
// dynamic imports keep OMP from loading before stdout belongs to the protocol.
const protocolStdout = isolateStdout();

const { ndJsonStream } = await import("@agentclientprotocol/sdk");
const { createPicoAgent, picoAgentShutdown } = await import("./server/pico-agent.ts");
const { createPicoSession } = await import("./engine/pico-session.ts");

/** How long shutdown may take before Pico reports an unclean exit. */
const SHUTDOWN_GRACE_MS = 5_000;

const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    version: string;
};

const app = createPicoAgent({
    version: manifest.version,
    createSession: (cwd, mcpServers) => createPicoSession({ cwd, mcpServers }),
});

const connection = app.connect(ndJsonStream(protocolStdout, Bun.stdin.stream()));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => connection.close());
}

await connection.closed;

const expiry = Promise.withResolvers<false>();
const timer = setTimeout(() => expiry.resolve(false), SHUTDOWN_GRACE_MS);
const disposed = await Promise.race([picoAgentShutdown(app).then(() => true), expiry.promise]);
clearTimeout(timer);

if (!disposed) console.error(`pico: sessions were still disposing after ${SHUTDOWN_GRACE_MS}ms`);
process.exit(disposed ? 0 : 1);
