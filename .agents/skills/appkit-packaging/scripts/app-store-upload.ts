// app-store-upload.ts
// Validate + upload an App-Store-signed flat .pkg to App Store Connect
// (TestFlight / Mac App Store) using an App Store Connect API key (.p8).
//
// NO notarytool here: notarytool is a NOTARIZER for Developer ID distribution,
// NOT a store uploader. Store binaries go through `xcrun altool` (validate then
// upload). NO interactive passwords anywhere — ASC API key auth only.
//
// Prerequisites (built earlier in the packaging pipeline, not by this script):
//   - App signing cert:       Apple Distribution        (NOT Developer ID Application)
//   - Installer signing cert: Mac Installer Distribution (NOT Developer ID Installer)
//   - App Sandbox is MANDATORY for the Mac App Store.
//   - Export with ExportOptions method = app-store-connect (the current key;
//     the old `app-store` value is deprecated), e.g.:
//       xcodebuild -exportArchive -archivePath X.xcarchive \
//         -exportOptionsPlist ExportOptions.plist -exportPath ./export
//
// Usage:
//   bun .agents/skills/appkit-packaging/scripts/app-store-upload.ts -f App.pkg -k <KEY_ID> -i <ISSUER_ID> -p AuthKey.p8
//
// Env var equivalents (flags win over env):
//   PKG_PATH, KEY_ID, ISSUER_ID, P8_PATH
//
// Bun >= 1.4.4, no dependencies.

import { spawnSync } from "node:child_process";
import {
    accessSync,
    chmodSync,
    constants as fsConstants,
    copyFileSync,
    mkdirSync,
    statSync,
} from "node:fs";
import { constants as osConstants, homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = `Usage: bun .agents/skills/appkit-packaging/scripts/app-store-upload.ts -f <App.pkg> -k <KEY_ID> -i <ISSUER_ID> -p <AuthKey.p8>

  -f  Path to the App-Store-signed flat installer .pkg (or env PKG_PATH)
  -k  App Store Connect API Key ID                      (or env KEY_ID)
  -i  App Store Connect Issuer ID                        (or env ISSUER_ID)
  -p  Path to the AuthKey_<KEY_ID>.p8 private key file    (or env P8_PATH)
  -h  Show this help

All four values are required. Secrets are read from files/args only —
this script never prompts for or accepts an interactive password.

Caveat (--apiIssuer / --issuer): a TEAM-scoped key REQUIRES the Issuer ID.
An INDIVIDUAL-scoped key must OMIT the issuer (passing it returns HTTP 401).
This script targets TEAM keys (issuer required); for an Individual key, drop
the -i flag and remove --apiIssuer from the altool calls below.
`;

/** Bad flags or missing required values: `error: …`, the usage block, exit 2. */
export class UsageError extends Error {}

/** A bad path or missing tool: `error: …`, exit 2, no usage block. */
export class InputError extends Error {}

/** A step that ran and failed: `error: …`, exit 1. */
export class FailureError extends Error {}

export interface UploadOptions {
    pkgPath: string;
    keyId: string;
    issuerId: string;
    p8Path: string;
    help: boolean;
}

// The shell original used getopts, so only the short flags are documented and
// only they are guaranteed. parseArgs needs a long name per option, so each
// short flag carries one; the names match mas-export-submit.ts.
const OPTIONS = {
    pkg: { type: "string", short: "f" },
    "key-id": { type: "string", short: "k" },
    "issuer-id": { type: "string", short: "i" },
    p8: { type: "string", short: "p" },
    help: { type: "boolean", short: "h" },
} as const;

type Flags = Record<string, string | boolean | undefined>;

function flagString(values: Flags, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

/** Restates parseArgs' complaints in the words getopts used. */
function argErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '([^']+)'/.exec(message);
    if (unknown) {
        return `unknown flag ${unknown[1]}`;
    }
    const missing = /Option '(-[^ ,']+)[^']*' argument missing/.exec(message);
    if (missing) {
        return `flag ${missing[1]} requires an argument`;
    }
    return message;
}

/** Seeded from the env, then overridden by flags. */
export function parseUploadArgs(
    argv: readonly string[],
    env: Record<string, string | undefined>,
): UploadOptions {
    let values: Flags;
    try {
        // Trailing operands are ignored, the way getopts ignored anything after
        // the last flag.
        values = parseArgs({
            args: [...argv],
            options: OPTIONS,
            allowPositionals: true,
            strict: true,
        }).values;
    } catch (error) {
        throw new UsageError(argErrorMessage(error));
    }
    return {
        pkgPath: flagString(values, "pkg") ?? env.PKG_PATH ?? "",
        keyId: flagString(values, "key-id") ?? env.KEY_ID ?? "",
        issuerId: flagString(values, "issuer-id") ?? env.ISSUER_ID ?? "",
        p8Path: flagString(values, "p8") ?? env.P8_PATH ?? "",
        help: values.help === true,
    };
}

/** Every unset required value, labelled and ordered as the shell loop had them. */
export function missingRequired(options: UploadOptions): string[] {
    const missing: string[] = [];
    if (!options.pkgPath) {
        missing.push(".pkg path (-f)");
    }
    if (!options.keyId) {
        missing.push("KEY_ID (-k)");
    }
    if (!options.issuerId) {
        missing.push("ISSUER_ID (-i)");
    }
    if (!options.p8Path) {
        missing.push(".p8 path (-p)");
    }
    return missing;
}

/** A store upload wants the flat installer, not the .app or a .dmg. */
export function isFlatPackage(path: string): boolean {
    return path.endsWith(".pkg");
}

/**
 * Where altool will look for the key.
 *
 * altool takes NO key-path argument by default. It searches, in order:
 *   ./private_keys  ~/private_keys  ~/.private_keys  ~/.appstoreconnect/private_keys
 *   and $API_PRIVATE_KEYS_DIR — for a file named EXACTLY AuthKey_<KEY_ID>.p8.
 * We copy the provided key into ~/.appstoreconnect/private_keys/ under the
 * required name so altool can find it. (Modern altool also accepts
 * `--p8-file-path <path>`; we install to the canonical dir instead, which works
 * across versions.)
 */
export function altoolKeyDirectory(home: string): string {
    return join(home, ".appstoreconnect", "private_keys");
}

export function altoolKeyPath(home: string, keyId: string): string {
    return join(altoolKeyDirectory(home), `AuthKey_${keyId}.p8`);
}

/**
 * `"$(cd "$(dirname "$P8_PATH")" && pwd)/$(basename "$P8_PATH")"` — absolute,
 * but like bash's logical `pwd` it does not resolve symlinks.
 */
export function absolutePath(path: string, cwd: string): string {
    return join(resolve(cwd, dirname(path)), basename(path));
}

/** `command -v <name>`: first executable of that name on PATH. */
export function onPath(command: string, pathEnv: string | undefined): boolean {
    for (const dir of (pathEnv ?? "").split(":")) {
        if (!dir) {
            continue;
        }
        try {
            accessSync(join(dir, command), fsConstants.X_OK);
            return true;
        } catch {
            // not here; keep looking
        }
    }
    return false;
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function log(message: string): void {
    process.stderr.write(`${message}\n`);
}

/** Bash reports a signalled child as 128 + the signal number. */
function signalExitCode(signal: NodeJS.Signals): number {
    const number = osConstants.signals[signal];
    return 128 + (typeof number === "number" ? number : 0);
}

function spawnStatus(command: string, args: readonly string[]): number {
    const result = spawnSync(command, [...args], { stdio: "inherit" });
    if (result.error) {
        log(`error: cannot run ${command}: ${result.error.message}`);
        process.exit(127); // what a shell returns for a command it cannot execute
    }
    if (result.signal) {
        return signalExitCode(result.signal);
    }
    return result.status ?? 1;
}

/** Runs a command and, like `set -e`, aborts with its exit status on failure. */
function run(command: string, args: readonly string[]): void {
    const status = spawnStatus(command, args);
    if (status !== 0) {
        process.exit(status);
    }
}

function upload(argv: readonly string[], env: Record<string, string | undefined>): void {
    const options = parseUploadArgs(argv, env);
    if (options.help) {
        process.stderr.write(USAGE);
        process.exit(0);
    }

    // --- validate args ------------------------------------------------------
    const missing = missingRequired(options);
    if (missing.length > 0) {
        for (const label of missing) {
            log(`error: missing required ${label}`);
        }
        process.stderr.write(USAGE);
        process.exit(2);
    }

    if (!isFile(options.pkgPath)) {
        throw new InputError(`.pkg not found: ${options.pkgPath}`);
    }
    if (!isFlatPackage(options.pkgPath)) {
        throw new InputError(`expected a flat .pkg installer: ${options.pkgPath}`);
    }
    if (!isFile(options.p8Path)) {
        throw new InputError(`.p8 key not found: ${options.p8Path}`);
    }
    if (!onPath("xcrun", env.PATH)) {
        throw new InputError("xcrun not on PATH (install Xcode/CLT)");
    }

    // --- altool .p8 file-location trap --------------------------------------
    // See altoolKeyPath above for why the key has to live in that directory
    // under that exact name.
    const keyDir = altoolKeyDirectory(homedir());
    const destKey = altoolKeyPath(homedir(), options.keyId);
    mkdirSync(keyDir, { recursive: true });
    chmodSync(keyDir, 0o700);
    if (absolutePath(options.p8Path, process.cwd()) !== destKey) {
        copyFileSync(options.p8Path, destKey);
    }
    chmodSync(destKey, 0o600);
    log(`>> Installed API key for altool: ${destKey}`);

    // --- validate (must pass BEFORE we upload) ------------------------------
    // altool uses camelCase flags: --apiKey / --apiIssuer. -t macos selects platform.
    log(`>> Validating ${options.pkgPath} against App Store Connect ...`);
    const validation = spawnStatus("xcrun", [
        "altool",
        "--validate-app",
        "-f",
        options.pkgPath,
        "-t",
        "macos",
        "--apiKey",
        options.keyId,
        "--apiIssuer",
        options.issuerId,
    ]);
    if (validation !== 0) {
        throw new FailureError(
            "--validate-app failed; NOT uploading. Fix the issues above and retry.",
        );
    }
    log(">> Validation passed.");

    // --- upload -------------------------------------------------------------
    log(`>> Uploading ${options.pkgPath} to App Store Connect ...`);
    run("xcrun", [
        "altool",
        "--upload-app",
        "-f",
        options.pkgPath,
        "-t",
        "macos",
        "--apiKey",
        options.keyId,
        "--apiIssuer",
        options.issuerId,
    ]);
    log(">> Upload complete.");

    // --- next step (no CLI for this) ----------------------------------------
    process.stderr.write(`
NOTE: The build is now uploaded and will appear in App Store Connect /
TestFlight after processing (minutes). "Submit for Review" is a SEPARATE step
with NO first-party CLI — do it in the App Store Connect web UI (or via the
public ASC REST API / fastlane deliver). altool only validates and uploads.
`);
}

function reportAndExit(error: unknown): never {
    if (error instanceof UsageError) {
        log(`error: ${error.message}`);
        process.stderr.write(USAGE);
        process.exit(2);
    }
    if (error instanceof InputError) {
        log(`error: ${error.message}`);
        process.exit(2);
    }
    if (error instanceof FailureError) {
        log(`error: ${error.message}`);
        process.exit(1);
    }
    throw error;
}

function main(): void {
    try {
        upload(process.argv.slice(2), process.env);
    } catch (error) {
        reportAndExit(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
