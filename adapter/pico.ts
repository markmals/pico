// The entry point `tools/build-pico.ts` compiles into the `pico` executable. Nothing here
// may load Oh My Pi: its native loader reads `PI_NATIVES_DIR` the moment it is imported.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import manifest from "../package.json" with { type: "json" };
import { DataDirError, ensureDataDir, picoDataDir } from "./data-dir.ts";
import { parseInvocation } from "./invocation.ts";
import { installNativeAddon } from "./native-addon.ts";

const ADDON_FILENAME = "pi_natives.darwin-arm64.node";

const invocation = parseInvocation(process.argv.slice(2), process.stdin.isTTY === true);

if (invocation.kind === "version") {
    process.stdout.write(`pico ${manifest.version}\n`);
    process.exit(0);
}
if (invocation.kind === "usage") {
    process.stderr.write(invocation.message);
    process.exit(2);
}

const dataDir = picoDataDir(homedir());
const nativesDir = join(dataDir, "natives");
try {
    ensureDataDir(dataDir);
    const addon = await carriedAddon();
    installNativeAddon({
        source: addon.path,
        nativesDir,
        version: addon.version,
        filename: ADDON_FILENAME,
    });
} catch (error) {
    if (!(error instanceof DataDirError)) throw error;
    process.stderr.write(`pico: ${error.message}\n`);
    process.exit(1);
}
process.env.PI_NATIVES_DIR = nativesDir;

// Dynamic, so the agent and Oh My Pi load only after `PI_NATIVES_DIR` is set.
await import("./main.ts");

/**
 * The addon this executable carries and the version Oh My Pi's loader looks for. A source
 * run copies the installed platform package's file instead.
 */
async function carriedAddon(): Promise<{ path: string; version: string }> {
    if (process.env.PI_COMPILED === "true") {
        // Dynamic: the module imports a `.node` file, which only the bundler accepts.
        return (await import("./carried-addon.ts")).default;
    }
    const manifestPath = Bun.resolveSync(
        "@oh-my-pi/pi-natives-darwin-arm64/package.json",
        import.meta.dir,
    );
    const natives = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    return { path: join(dirname(manifestPath), ADDON_FILENAME), version: natives.version };
}
