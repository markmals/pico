/**
 * Exercises stdout isolation in a real process: every console writer Bun sends
 * to stdout, then one protocol message through the preserved handle. The test
 * reads both streams.
 */
import { isolateStdout } from "./stdout-isolation.ts";

const protocolStdout = isolateStdout();

console.log("noise from console.log");
console.info("noise from console.info");
console.debug("noise from console.debug");
console.dir({ origin: "noise from console.dir" });
console.dirxml({ origin: "noise from console.dirxml" });
console.table([{ origin: "noise from console.table" }]);
console.group("noise from console.group");
console.groupEnd();
console.groupCollapsed("noise from console.groupCollapsed");
console.groupEnd();
console.count("noise from console.count");
console.countReset("noise from console.count");
console.time("noise from console.time");
console.timeLog("noise from console.time");
console.timeEnd("noise from console.time");
console.trace("noise from console.trace");
console.assert(false, "noise from console.assert");
console.write("noise from console.write\n");
process.stdout.write("noise written straight to stdout\n");

const writer = protocolStdout.getWriter();
await writer.write(
    new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } })}\n`,
    ),
);
await writer.close();
