/**
 * Exercises stdout isolation in a real process: noisy writers first, then one
 * protocol message through the preserved handle. The test reads both streams.
 */
import { isolateStdout } from "./stdout-isolation.ts";

const protocolStdout = isolateStdout();

console.log("noise from console.log");
console.info("noise from console.info");
console.debug("noise from console.debug");
process.stdout.write("noise written straight to stdout\n");

const writer = protocolStdout.getWriter();
await writer.write(
    new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } })}\n`,
    ),
);
await writer.close();
