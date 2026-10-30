// notarize.ts — Developer ID: sign -> notarize -> staple -> verify
//
// Takes a built .app, signs it for Developer ID distribution, runs the full
// Apple notarization chain via notarytool, staples the ticket, and verifies.
// Optionally builds + signs a .dmg from the .app and notarizes/staples that too.
//
// Auth is ASC API key ONLY. No interactive passwords, no app-specific passwords.
// Either a stored notary keychain profile, or raw --key/--key-id/--issuer.
//
// Xcode 27 facts baked in:
//   - altool --notarize-app is REMOVED; notarytool is the only notarizer.
//   - notarytool accepts .dmg / .pkg / .zip only (NOT a raw .app).
//   - Staple the artifact you SHIP (.app/.dmg), NEVER the .zip you submitted.
//   - Use `ditto -c -k --keepParent` to zip (Finder "Compress" breaks signatures).
//   - Sign nested Mach-O inside-out, the bundle LAST; avoid `codesign --deep`.
//   - For a Team (Organization) ASC key, --issuer is required.
//     For an INDIVIDUAL ASC key, OMIT --issuer or notarytool 401s.
//
// Run it from the project root with
// `bun .agents/skills/appkit-packaging/scripts/notarize.ts …` — Bun >= 1.4.4, no
// dependencies. The shell original this replaces shelled out to the same Apple
// tools; only the glue language changed.

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = `Usage:
  bun .agents/skills/appkit-packaging/scripts/notarize.ts --app <App.app> --identity <"Developer ID Application: Name (TEAMID)"> \\
      ( --keychain-profile <PROFILE> | --key <AuthKey.p8> --key-id <KEYID> [--issuer <ISSUER>] ) \\
      [--make-dmg] [--entitlements <file.plist>]

Flags (or matching env vars):
  --app                APP                 Path to the built .app bundle (required)
  --identity           SIGN_IDENTITY       "Developer ID Application: ..." identity (required)
  --keychain-profile   NOTARY_PROFILE      Stored notarytool profile name (auth option A)
  --key                ASC_KEY             Path to ASC API .p8 key       (auth option B)
  --key-id             ASC_KEY_ID          ASC API Key ID                (auth option B)
  --issuer             ASC_ISSUER          ASC API Issuer ID (Team keys only; OMIT for Individual)
  --entitlements       ENTITLEMENTS        Optional entitlements plist for hardened runtime
  --make-dmg                               Also build + sign + notarize + staple a .dmg

Auth: provide EITHER --keychain-profile OR (--key + --key-id [+ --issuer]). Never both.
Create a profile once with:
  xcrun notarytool store-credentials "AC_NOTARY" --key <p8> --key-id <id> --issuer <iss>
`;

/** A misuse of the CLI: prints `ERROR: …`, then the usage block, then exits 2. */
export class UsageError extends Error {}

/** A runtime failure: prints `ERROR: …` and exits 1, no usage block. */
export class FailureError extends Error {}

export interface NotarizeOptions {
    app: string;
    identity: string;
    keychainProfile: string;
    key: string;
    keyId: string;
    issuer: string;
    entitlements: string;
    makeDmg: boolean;
    help: boolean;
}

const OPTIONS = {
    app: { type: "string" },
    identity: { type: "string" },
    "keychain-profile": { type: "string" },
    key: { type: "string" },
    "key-id": { type: "string" },
    issuer: { type: "string" },
    entitlements: { type: "string" },
    "make-dmg": { type: "boolean" },
    help: { type: "boolean", short: "h" },
} as const;

type Flags = Record<string, string | boolean | undefined>;

function flagString(values: Flags, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

/**
 * parseArgs rejects bad input in its own words; the shell script said
 * `unknown argument: --foo`, so translate the one case anybody sees.
 */
function argErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '([^']+)'/.exec(message);
    return unknown ? `unknown argument: ${unknown[1]}` : message;
}

/** Flags win over the matching env vars; anything unset stays an empty string. */
export function parseNotarizeArgs(
    argv: readonly string[],
    env: Record<string, string | undefined>,
): NotarizeOptions {
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
        app: flagString(values, "app") ?? env.APP ?? "",
        identity: flagString(values, "identity") ?? env.SIGN_IDENTITY ?? "",
        keychainProfile: flagString(values, "keychain-profile") ?? env.NOTARY_PROFILE ?? "",
        key: flagString(values, "key") ?? env.ASC_KEY ?? "",
        keyId: flagString(values, "key-id") ?? env.ASC_KEY_ID ?? "",
        issuer: flagString(values, "issuer") ?? env.ASC_ISSUER ?? "",
        entitlements: flagString(values, "entitlements") ?? env.ENTITLEMENTS ?? "",
        makeDmg: values["make-dmg"] === true,
        help: values.help === true,
    };
}

/**
 * Exactly one auth mode, turned into the notarytool auth arguments.
 *
 * `fileExists` is injected so the choice stays testable without a real .p8.
 */
export function notaryAuthArgs(
    options: NotarizeOptions,
    fileExists: (path: string) => boolean = isFile,
): string[] {
    if (options.keychainProfile) {
        if (options.key || options.keyId || options.issuer) {
            throw new FailureError(
                "use EITHER --keychain-profile OR --key/--key-id/--issuer, not both",
            );
        }
        return ["--keychain-profile", options.keychainProfile];
    }
    if (options.key && options.keyId) {
        if (!fileExists(options.key)) {
            throw new FailureError(`--key file not found: ${options.key}`);
        }
        const args = ["--key", options.key, "--key-id", options.keyId];
        // Team key -> --issuer required; Individual key -> OMIT --issuer (else 401).
        if (options.issuer) {
            args.push("--issuer", options.issuer);
        }
        return args;
    }
    throw new UsageError("no auth provided. Need --keychain-profile OR --key + --key-id.");
}

export interface SubmissionResult {
    id: string;
    status: string;
}

/**
 * Pulls the submission id and final status out of `notarytool submit --wait`
 * output, reproducing the shell original's two awk passes exactly:
 *
 *   id     — `awk '/[Ii]d:/{print $2; exit}'`: first line containing `Id:` or
 *            `id:`, second whitespace-separated field.
 *   status — `awk -F': *' '/status:/{print $2; exit}'`: first line containing
 *            `status:`, second field once the line is split on `: *`.
 *
 * The id pass keys on a substring, so it also matches notarytool's `path:`-era
 * lines only if they contain `id:` — in practice the `  id: <uuid>` line under
 * "Submission ID received" is the first hit. The status pass is why the submit
 * below passes `--no-progress`: the progress spinner's `Current status:
 * Accepted......` line would otherwise be the first `status:` match and yield
 * a dotted value that never equals "Accepted".
 */
export function parseSubmissionOutput(output: string): SubmissionResult {
    const lines = output.split("\n");
    let id = "";
    for (const line of lines) {
        if (/[Ii]d:/.test(line)) {
            id = line.trim().split(/\s+/)[1] ?? "";
            break;
        }
    }
    let status = "";
    for (const line of lines) {
        if (line.includes("status:")) {
            status = line.split(/: */)[1] ?? "";
            break;
        }
    }
    return { id, status };
}

/** `${APP%.app}` — drops a trailing `.app`, leaves anything else alone. */
export function stripAppSuffix(app: string): string {
    return app.endsWith(".app") ? app.slice(0, -".app".length) : app;
}

/** `${artifact%.*}.notary-log.json` — strips the last extension, if any. */
export function notaryLogPath(artifact: string): string {
    const dot = artifact.lastIndexOf(".");
    return `${dot === -1 ? artifact : artifact.slice(0, dot)}.notary-log.json`;
}

/**
 * Gatekeeper's assessment of a launchable app bundle. `-t exec` is the policy a
 * user meets on first launch; `-t install` assesses installer packages and rejects
 * a `.app` outright, so it proves nothing about the bundle being shipped. The
 * `.dmg` below keeps `-t install`: a disk image is a container, not an executable.
 */
export function gatekeeperAppArgs(app: string): string[] {
    return ["-a", "-t", "exec", "-vv", app];
}

const NESTED_SUFFIXES = [".dylib", ".framework", ".app", ".xpc", ".bundle"];

/** The `find … \( -name '*.dylib' -o … \)` name test, one entry at a time. */
export function isNestedSigningTarget(name: string): boolean {
    return NESTED_SUFFIXES.some(suffix => name.endsWith(suffix));
}

/**
 * Reproduces `find "$APP/Contents" \( -name '*.dylib' -o … \) -print0`: the
 * same name test, symlinks not followed, and no `-prune`, so the walk also
 * descends into the bundles it matches. Paths are concatenated rather than
 * normalised, so the printed `sign:` lines keep the caller's spelling of the
 * .app path, exactly like find.
 *
 * Two things worth knowing about the order, both inherited from the shell:
 *   - It is pre-order, like find's: a wrapper is yielded before the Mach-O
 *     nested inside it, so "inside-out" here means "everything under
 *     Contents before the .app itself", not "deepest first".
 *   - Entries of one directory come back in the filesystem's order, as they
 *     did under find, so sibling order is not part of the contract. Same set
 *     of targets either way, and `codesign` is run once per target.
 */
export function findNestedSigningTargets(root: string): string[] {
    const found: string[] = [];
    const visit = (dir: string): void => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // find warns and carries on when a directory is unreadable
        }
        for (const entry of entries) {
            const path = `${dir}/${entry.name}`;
            if (isNestedSigningTarget(entry.name)) {
                found.push(path);
            }
            if (entry.isDirectory()) {
                visit(path);
            }
        }
    };
    visit(root);
    return found;
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
    process.stderr.write(`${message}\n`);
}

/** Bash reports a signalled child as 128 + the signal number. */
function signalExitCode(signal: NodeJS.Signals): number {
    const number = constants.signals[signal];
    return 128 + (typeof number === "number" ? number : 0);
}

/**
 * Runs a command with stdio inherited and, like `set -e`, aborts the script
 * with the failed command's own exit status.
 */
function run(command: string, args: readonly string[]): void {
    const result = spawnSync(command, [...args], { stdio: "inherit" });
    if (result.error) {
        log(`ERROR: cannot run ${command}: ${result.error.message}`);
        process.exit(127); // what a shell returns for a command it cannot execute
    }
    if (result.signal) {
        process.exit(signalExitCode(result.signal));
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

/**
 * `out="$(cmd 2>&1)"`: both streams into one buffer, interleaved in the order
 * they were written. spawnSync's two separate pipes would lose that ordering,
 * so point stdout and stderr at a single temp file descriptor — which is what
 * the shell's `2>&1` does.
 */
function runCapturingCombinedOutput(
    command: string,
    args: readonly string[],
): { status: number; output: string } {
    const path = `${tmpdir()}/notarize-${process.pid}-${Date.now()}.log`;
    const fd = openSync(path, "w+");
    try {
        const result = spawnSync(command, [...args], { stdio: ["ignore", fd, fd] });
        const output = readFileSync(path, "utf8");
        if (result.error) {
            log(`ERROR: cannot run ${command}: ${result.error.message}`);
            process.exit(127);
        }
        const status = result.signal ? signalExitCode(result.signal) : (result.status ?? 1);
        return { status, output };
    } finally {
        closeSync(fd);
        rmSync(path, { force: true });
    }
}

/** Submits one artifact (.zip/.dmg/.pkg) and blocks until Apple answers. */
function submitAndWait(artifact: string, auth: readonly string[]): void {
    log(`>> notarytool submit ${artifact} --wait`);
    const { status: exitCode, output } = runCapturingCombinedOutput("xcrun", [
        "notarytool",
        "submit",
        artifact,
        ...auth,
        "--wait",
        "--no-progress",
    ]);
    // `echo "$out"`: command substitution ate the trailing newlines, echo added
    // exactly one back.
    process.stderr.write(`${output.replace(/\n+$/, "")}\n`);

    const { id, status } = parseSubmissionOutput(output);
    if (status !== "Accepted" || exitCode !== 0) {
        // On Invalid (or any non-Accepted), pull the detailed log and fail loudly.
        if (id) {
            const logPath = notaryLogPath(artifact);
            log(`>> Notarization NOT accepted (status=${status}). Fetching log -> ${logPath}`);
            // `|| true` in the original: a failed log fetch must not mask the
            // real error. notarytool's stdout goes to stderr with the rest.
            spawnSync("xcrun", ["notarytool", "log", id, ...auth, logPath], {
                stdio: ["ignore", 2, 2],
            });
            log(`ERROR: notarization failed. See log: ${logPath}`);
        } else {
            log("ERROR: notarization failed and no submission id was returned.");
        }
        process.exit(1);
    }
    log(`>> Accepted (submission ${id})`);
}

function notarize(argv: readonly string[], env: Record<string, string | undefined>): void {
    const options = parseNotarizeArgs(argv, env);
    if (options.help) {
        // The shell original exited 2 here, conflating `--help` with misuse.
        // Asking for help is not a usage error.
        process.stderr.write(USAGE);
        process.exit(0);
    }

    // --- validate inputs -----------------------------------------------------
    const app = options.app;
    if (!app) {
        throw new UsageError("--app is required");
    }
    if (!isDirectory(app) || !app.endsWith(".app")) {
        throw new FailureError(`--app must be an existing .app bundle: ${app}`);
    }
    if (!options.identity) {
        throw new UsageError("--identity (Developer ID Application) is required");
    }

    // Exactly one auth mode. Build the notarytool auth args.
    const auth = notaryAuthArgs(options);

    const entitlementArgs: string[] = [];
    if (options.entitlements) {
        if (!isFile(options.entitlements)) {
            throw new FailureError(`entitlements not found: ${options.entitlements}`);
        }
        entitlementArgs.push("--entitlements", options.entitlements);
    }

    log(`>> Notarizing: ${app}`);
    log(`>> Identity:   ${options.identity}`);

    // --- 1. strip quarantine -------------------------------------------------
    log(">> [1/6] Stripping quarantine xattrs (xattr -cr)");
    run("xattr", ["-cr", app]);

    // --- 2. sign nested Mach-O inside-out, then the bundle LAST ---------------
    // Hardened runtime (--options runtime) + secure timestamp (--timestamp) are
    // both MANDATORY for notarization. We deliberately avoid `--deep` (unreliable,
    // Apple-deprecated): we sign inner binaries first, the .app wrapper last.
    log(">> [2/6] Signing nested Mach-O inside-out, bundle last");
    for (const inner of findNestedSigningTargets(`${app}/Contents`)) {
        if (inner === app) {
            continue; // bundle itself signed last
        }
        log(`   sign: ${inner}`);
        run("codesign", [
            "--force",
            "--options",
            "runtime",
            "--timestamp",
            "--sign",
            options.identity,
            ...entitlementArgs,
            inner,
        ]);
    }

    log(`   sign (bundle last): ${app}`);
    run("codesign", [
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        options.identity,
        ...entitlementArgs,
        app,
    ]);

    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);

    // --- 3. zip with ditto + notarytool submit --wait -------------------------
    const zip = `${stripAppSuffix(app)}.zip`;
    log(`>> [3/6] ditto -c -k --keepParent -> ${zip} (NOT a Finder zip)`);
    rmSync(zip, { force: true });
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);

    log(">> [4/6] Submitting for notarization");
    submitAndWait(zip, auth);

    // --- 4. staple the SHIPPED artifact (the .app), then verify ---------------
    // Staple the .app — never the .zip (the .zip was only a transport for submit).
    log(`>> [5/6] Stapling ticket to ${app}`);
    run("xcrun", ["stapler", "staple", app]);
    run("xcrun", ["stapler", "validate", app]);

    log(">> [6/6] Verifying signature + Gatekeeper assessment");
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    run("spctl", gatekeeperAppArgs(app));
    rmSync(zip, { force: true }); // transport artifact no longer needed
    log(">> .app DONE: signed, notarized, stapled, verified.");

    // --- optional: build + sign + notarize + staple a .dmg --------------------
    if (options.makeDmg) {
        const dmg = `${stripAppSuffix(app)}.dmg`;
        log(`>> [dmg] Building ${dmg} via hdiutil`);
        rmSync(dmg, { force: true });
        run("hdiutil", [
            "create",
            "-volname",
            basename(stripAppSuffix(app)),
            "-srcfolder",
            app,
            "-ov",
            "-format",
            "UDZO",
            dmg,
        ]);
        log(`>> [dmg] Signing ${dmg} (Developer ID Application, hardened runtime + timestamp)`);
        run("codesign", [
            "--force",
            "--options",
            "runtime",
            "--timestamp",
            "--sign",
            options.identity,
            dmg,
        ]);
        log(`>> [dmg] Notarizing ${dmg} (notarytool accepts .dmg directly)`);
        submitAndWait(dmg, auth);
        log(`>> [dmg] Stapling + verifying ${dmg}`);
        run("xcrun", ["stapler", "staple", dmg]);
        run("xcrun", ["stapler", "validate", dmg]);
        run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", dmg]);
        run("spctl", ["-a", "-vvv", "-t", "install", dmg]);
        log(`>> .dmg DONE: ${dmg}`);
    }

    log(">> All artifacts shipped.");
}

function reportAndExit(error: unknown): never {
    if (error instanceof UsageError) {
        log(`ERROR: ${error.message}`);
        process.stderr.write(USAGE);
        process.exit(2);
    }
    if (error instanceof FailureError) {
        log(`ERROR: ${error.message}`);
        process.exit(1);
    }
    throw error;
}

function main(): void {
    try {
        notarize(process.argv.slice(2), process.env);
    } catch (error) {
        reportAndExit(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
