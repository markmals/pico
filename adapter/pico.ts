// The entry point `tools/build-pico.ts` compiles into the `pico` executable. Nothing here
// may load Oh My Pi: its native loader reads `PI_NATIVES_DIR` the moment it is imported, and
// discovery commands must answer without it (proposal.0007).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import manifest from "../package.json" with { type: "json" };
import { runWithoutRuntime } from "./cli/commands/dispatch.ts";
import { CliError } from "./cli/errors.ts";
import { renderError } from "./cli/output.ts";
import { planInvocation } from "./cli/plan.ts";
import { DataDirError, ensureDataDir, picoDataDir } from "./data-dir.ts";
import { installNativeAddon } from "./native-addon.ts";
import { isolateStdout } from "./stdout-isolation.ts";

const ADDON_FILENAME = "pi_natives.darwin-arm64.node";

const stdoutIsTerminal = process.stdout.isTTY === true;
const invocation = planInvocation(
    process.argv.slice(2),
    process.stdin.isTTY === true,
    stdoutIsTerminal,
);

if (invocation.kind === "version") {
    process.stdout.write(`pico ${manifest.version}\n`);
} else if (invocation.kind === "respond") {
    if (invocation.stdout !== undefined) process.stdout.write(invocation.stdout);
    if (invocation.stderr !== undefined) process.stderr.write(invocation.stderr);
    process.exitCode = invocation.exitCode;
} else {
    const dataDir = picoDataDir(homedir());
    const nativesDir = join(dataDir, "natives");
    const command =
        invocation.kind === "run" ? { ...invocation, stdout: isolateStdout() } : undefined;
    if (command !== undefined) {
        const early = await runWithoutRuntime(
            command.command,
            command.input,
            dataDir,
            command.stdout,
            stdoutIsTerminal,
        );
        if (early !== undefined) process.exit(early);
    }
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
        if (invocation.kind === "acp") {
            process.stderr.write(`pico: ${error.message}\n`);
        } else {
            const failure = new CliError("IO_ERROR", `pico: ${error.message}`, {
                details: { path: dataDir },
            });
            process.stderr.write(renderError(failure));
        }
        process.exit(1);
    }
    process.env.PI_NATIVES_DIR = nativesDir;

    // Dynamic, so the agent, the commands and Oh My Pi load only after `PI_NATIVES_DIR` is set.
    if (command === undefined) {
        await import("./main.ts");
    } else {
        const { runCommand } = await import("./cli/commands/run.ts");
        const exitCode = await runCommand(
            command.command,
            command.input,
            dataDir,
            command.stdout,
            stdoutIsTerminal,
        );
        process.exit(exitCode);
    }
}

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
