// mas-export-submit.ts — Mac App Store pipeline from an xcarchive.
//   archive (optional) → xcodebuild -exportArchive (method=app-store-connect) → altool validate + upload
//
// Auth is App Store Connect API key ONLY — no Apple ID, no app-specific password, no interactive prompt.
// "Submit for Review" is NOT scripted here: there is no first-party CLI for the final submit
// (App Store Connect browser UI / fastlane deliver / ASC API). This stops at a successful upload.
//
// Bun >= 1.4.4, no dependencies, run from the project root:
// `bun .agents/skills/appkit-packaging/scripts/mas-export-submit.ts [options]`.

import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = `Usage: bun .agents/skills/appkit-packaging/scripts/mas-export-submit.ts [options]

Provide an existing archive OR a scheme to archive:
  -a, --archive PATH       Path to an existing .xcarchive
  -s, --scheme NAME        Scheme to archive (used only when --archive is absent)

Export options (a plist is generated if not supplied):
  -o, --export-options P   ExportOptions.plist (method MUST be app-store-connect)
  -t, --team-id TEAMID     10-char Team ID (required when generating the plist)
  -e, --export-path DIR    Export output dir (default: ./export)

App Store Connect API key (all three required — no passwords anywhere):
  -k, --key-id KEYID       ASC API Key ID            (env: KEY_ID)
  -i, --issuer-id ISSUER   ASC API Issuer ID         (env: ISSUER_ID)
  -p, --p8 PATH            Path to AuthKey_<KEYID>.p8 (env: P8_PATH)

      --no-upload          Export only; skip altool validate/upload.
  -h, --help               Show this help.

Env equivalents: ARCHIVE_PATH, SCHEME, EXPORT_OPTIONS, TEAM_ID, EXPORT_PATH, KEY_ID, ISSUER_ID, P8_PATH.
`;

// The shell original routed every bad-argument case through `die` (exit 1, no
// usage block) and reserved exit 2 for `usage`. This port follows the split
// that convention implied: an argument the caller got wrong prints the usage
// and exits 2, while a step that ran and failed (missing xcarchive, no .pkg in
// the export, unreadable .p8) still prints `ERROR: …` and exits 1. The message
// strings are unchanged either way.

/** A bad or missing argument: `ERROR: …`, the usage block, exit 2. */
export class UsageError extends Error {}

/** A runtime failure: `ERROR: …`, exit 1 — the shell original's `die`. */
export class FailureError extends Error {}

export interface MasOptions {
    archivePath: string;
    scheme: string;
    exportOptions: string;
    teamId: string;
    exportPath: string;
    keyId: string;
    issuerId: string;
    p8Path: string;
    upload: boolean;
    help: boolean;
}

const OPTIONS = {
    archive: { type: "string", short: "a" },
    scheme: { type: "string", short: "s" },
    "export-options": { type: "string", short: "o" },
    "team-id": { type: "string", short: "t" },
    "export-path": { type: "string", short: "e" },
    "key-id": { type: "string", short: "k" },
    "issuer-id": { type: "string", short: "i" },
    p8: { type: "string", short: "p" },
    "no-upload": { type: "boolean" },
    help: { type: "boolean", short: "h" },
} as const;

type Flags = Record<string, string | boolean | undefined>;

function flagString(values: Flags, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

/** parseArgs words it differently; the shell said `unknown argument: …`. */
function argErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '([^']+)'/.exec(message);
    return unknown ? `unknown argument: ${unknown[1]}` : message;
}

/** Flags win over the env equivalents; `--export-path` defaults to ./export. */
export function parseMasArgs(
    argv: readonly string[],
    env: Record<string, string | undefined>,
): MasOptions {
    let values: Flags;
    let positionals: string[];
    try {
        const parsed = parseArgs({
            args: [...argv],
            options: OPTIONS,
            allowPositionals: true,
            strict: true,
        });
        values = parsed.values;
        positionals = parsed.positionals;
    } catch (error) {
        throw new UsageError(argErrorMessage(error));
    }
    if (positionals.length > 0) {
        throw new UsageError(`unknown argument: ${positionals[0]}`);
    }
    return {
        archivePath: flagString(values, "archive") ?? env.ARCHIVE_PATH ?? "",
        scheme: flagString(values, "scheme") ?? env.SCHEME ?? "",
        exportOptions: flagString(values, "export-options") ?? env.EXPORT_OPTIONS ?? "",
        teamId: flagString(values, "team-id") ?? env.TEAM_ID ?? "",
        exportPath: flagString(values, "export-path") ?? env.EXPORT_PATH ?? "./export",
        keyId: flagString(values, "key-id") ?? env.KEY_ID ?? "",
        issuerId: flagString(values, "issuer-id") ?? env.ISSUER_ID ?? "",
        p8Path: flagString(values, "p8") ?? env.P8_PATH ?? "",
        upload: values["no-upload"] !== true,
        help: values.help === true,
    };
}

/** The argument checks, in the order the shell script made them. */
export function validateMasOptions(options: MasOptions): void {
    if (!options.archivePath && !options.scheme) {
        throw new UsageError("supply --archive PATH or --scheme NAME");
    }
    if (options.upload) {
        if (!options.keyId) {
            throw new UsageError("--key-id / KEY_ID required (or pass --no-upload)");
        }
        if (!options.issuerId) {
            throw new UsageError(
                "--issuer-id / ISSUER_ID required (Team key; OMIT only for INDIVIDUAL keys)",
            );
        }
    }
}

/** Where `--scheme NAME` archives to when no `--archive` was given. */
export function defaultArchivePath(scheme: string): string {
    return `./build/${scheme}.xcarchive`;
}

/**
 * The minimal store ExportOptions.plist.
 *
 * method MUST be app-store-connect. NEVER write the deprecated 'app-store' value.
 */
export function buildExportOptionsPlist(teamId: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>${teamId}</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
`;
}

/**
 * `find "$EXPORT_PATH" -maxdepth 1 -name '*.pkg' | head -n1`.
 *
 * A store export produces a flat, installer-signed .pkg (Mac Installer
 * Distribution cert); directory order decides which one wins if there are two.
 */
export function firstPackage(entries: readonly string[]): string | undefined {
    return entries.find(entry => entry.endsWith(".pkg"));
}

/**
 * altool takes NO key path: it searches ./private_keys, ~/private_keys, ~/.private_keys,
 * ~/.appstoreconnect/private_keys, and $API_PRIVATE_KEYS_DIR for a file named exactly
 * AuthKey_<KEYID>.p8. We stage the supplied .p8 into ~/.appstoreconnect/private_keys so the
 * search succeeds. (Same .p8 file-location handling as app-store-upload.ts.)
 */
export function altoolKeyPath(home: string, keyId: string): string {
    return join(home, ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
}

/**
 * `"$(cd "$(dirname "$P8_PATH")" && pwd)/$(basename "$P8_PATH")"` — absolute,
 * but like bash's logical `pwd` it does not resolve symlinks.
 */
export function absolutePath(path: string, cwd: string): string {
    return join(resolve(cwd, dirname(path)), basename(path));
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function log(message: string): void {
    process.stderr.write(`>> ${message}\n`);
}

/** Bash reports a signalled child as 128 + the signal number. */
function signalExitCode(signal: NodeJS.Signals): number {
    const number = osConstants.signals[signal];
    return 128 + (typeof number === "number" ? number : 0);
}

/** Runs a command and, like `set -e`, aborts with its exit status on failure. */
function run(command: string, args: readonly string[]): void {
    const result = spawnSync(command, [...args], { stdio: "inherit" });
    if (result.error) {
        process.stderr.write(`ERROR: cannot run ${command}: ${result.error.message}\n`);
        process.exit(127); // what a shell returns for a command it cannot execute
    }
    if (result.signal) {
        process.exit(signalExitCode(result.signal));
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function exportAndSubmit(argv: readonly string[], env: Record<string, string | undefined>): void {
    const options = parseMasArgs(argv, env);
    if (options.help) {
        process.stderr.write(USAGE);
        process.exit(0);
    }

    // ---- 1. validate inputs -------------------------------------------------
    validateMasOptions(options);

    // Removed on exit: the generated plist directory, and the .p8 we staged —
    // never a key that was already there. The shell original did this with two
    // `trap … EXIT` handlers.
    let generatedPlistDir: string | undefined;
    let stagedKey: string | undefined;
    process.on("exit", () => {
        if (generatedPlistDir) {
            rmSync(generatedPlistDir, { recursive: true, force: true });
        }
        if (stagedKey) {
            rmSync(stagedKey, { force: true });
        }
    });

    // ---- archive on demand --------------------------------------------------
    let archivePath = options.archivePath;
    if (!archivePath) {
        archivePath = defaultArchivePath(options.scheme);
        log(`archiving scheme '${options.scheme}' → ${archivePath}`);
        // App Sandbox + an increasing CFBundleVersion + Apple Distribution signing must already be set in the project.
        run("xcodebuild", [
            "-scheme",
            options.scheme,
            "-configuration",
            "Release",
            "-archivePath",
            archivePath,
            "archive",
        ]);
    }
    if (!isDirectory(archivePath)) {
        throw new FailureError(`xcarchive not found: ${archivePath}`);
    }

    // ---- 2. generate a minimal ExportOptions.plist if none supplied ---------
    let exportOptions = options.exportOptions;
    if (!exportOptions) {
        if (!options.teamId) {
            throw new UsageError(
                "--team-id required to generate an ExportOptions.plist (or pass --export-options)",
            );
        }
        // `mktemp -t ExportOptions-AppStore.XXXXXX.plist` in the original; a
        // private 0700 directory keeps the Team ID out of a world-readable file.
        generatedPlistDir = mkdtempSync(join(tmpdir(), "ExportOptions-AppStore."));
        exportOptions = join(generatedPlistDir, "ExportOptions.plist");
        log(
            `generating ExportOptions.plist (method=app-store-connect, signingStyle=automatic) → ${exportOptions}`,
        );
        writeFileSync(exportOptions, buildExportOptionsPlist(options.teamId));
    }
    if (!isFile(exportOptions)) {
        throw new FailureError(`ExportOptions.plist not found: ${exportOptions}`);
    }

    // ---- 3a. export the archive ---------------------------------------------
    rmSync(options.exportPath, { recursive: true, force: true });
    log(`xcodebuild -exportArchive → ${options.exportPath}`);
    run("xcodebuild", [
        "-exportArchive",
        "-archivePath",
        archivePath,
        "-exportOptionsPlist",
        exportOptions,
        "-exportPath",
        options.exportPath,
    ]);

    let exported: string[];
    try {
        exported = readdirSync(options.exportPath);
    } catch {
        exported = [];
    }
    const packageName = firstPackage(exported);
    if (!packageName) {
        throw new FailureError(
            `no .pkg in ${options.exportPath} — a store export must yield a signed flat .pkg`,
        );
    }
    const pkg = `${options.exportPath}/${packageName}`;
    log(`exported package: ${pkg}`);

    // ---- 3b. validate + upload via altool -----------------------------------
    // NOTE: --upload-app is the ONLY store uploader (notarytool is NOT a store uploader);
    //       altool --notarize-app was REMOVED in Xcode 27.
    if (!options.upload) {
        log(`--no-upload: export complete, skipping altool. Package: ${pkg}`);
    } else {
        if (options.p8Path) {
            if (!isFile(options.p8Path)) {
                throw new FailureError(`p8 not found: ${options.p8Path}`);
            }
            const dest = altoolKeyPath(homedir(), options.keyId); // exact name altool greps for
            mkdirSync(dirname(dest), { recursive: true });
            if (absolutePath(options.p8Path, process.cwd()) !== dest) {
                copyFileSync(options.p8Path, dest);
                stagedKey = dest; // clean up only a key WE copied in
            }
            log(`staged API key at ${dest}`);
        } else {
            log(
                `no --p8 given; relying on altool's default private_keys search dirs for AuthKey_${options.keyId}.p8`,
            );
        }

        // --apiKey / --apiIssuer are camelCase. -t macos targets the Mac platform.
        log("altool --validate-app (macos)");
        run("xcrun", [
            "altool",
            "--validate-app",
            "-f",
            pkg,
            "-t",
            "macos",
            "--apiKey",
            options.keyId,
            "--apiIssuer",
            options.issuerId,
        ]);

        log("altool --upload-app (macos)");
        run("xcrun", [
            "altool",
            "--upload-app",
            "-f",
            pkg,
            "-t",
            "macos",
            "--apiKey",
            options.keyId,
            "--apiIssuer",
            options.issuerId,
        ]);

        log("upload accepted — App Store Connect is now processing the build (~5–30 min).");
    }

    // ---- 4. reminders -------------------------------------------------------
    process.stderr.write(`
────────────────────────────────────────────────────────────────────────────
Mac App Store reminders:
  • App Sandbox is MANDATORY — com.apple.security.app-sandbox must be in the
    app's entitlements, or the build is rejected at upload/processing.
  • App signing cert  = "Apple Distribution"          (NOT Developer ID Application)
  • Installer cert    = "Mac Installer Distribution"  (NOT Developer ID Installer)
  • Notarization does NOT apply here — the store does App Review and re-signs.
  • FINAL STEP IS BROWSER-ONLY: "Submit for Review" has no first-party CLI.
    Do it in App Store Connect (or fastlane deliver / the ASC API). TestFlight
    internal testers get the build automatically once processing finishes.
────────────────────────────────────────────────────────────────────────────
`);
}

function reportAndExit(error: unknown): never {
    if (error instanceof UsageError) {
        process.stderr.write(`ERROR: ${error.message}\n`);
        process.stderr.write(USAGE);
        process.exit(2);
    }
    if (error instanceof FailureError) {
        process.stderr.write(`ERROR: ${error.message}\n`);
        process.exit(1);
    }
    throw error;
}

function main(): void {
    try {
        exportAndSubmit(process.argv.slice(2), process.env);
    } catch (error) {
        reportAndExit(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
