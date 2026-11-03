// Compiles `native/keychain/pico_keychain.m` into the `.node` addon that both the development
// launcher and the compiled executable load. `tools/build-pico.ts` calls `buildKeychain` before
// bundling, because `adapter/credentials/carried-keychain.ts` embeds the file it writes.
//
// The only build input beyond this checkout is Xcode: `xcrun` resolves clang, the macOS SDK and
// the Security, Foundation and LocalAuthentication frameworks. There is no node-gyp, no
// prebuild step and no runtime package.
//
// `native/keychain/include/` holds the official Node-API headers, copied verbatim from
// node-api-headers 1.9.0 (MIT; its LICENSE sits beside them), published by the Node.js project
// at https://github.com/nodejs/node-api-headers. The tarball those files came from is
// https://registry.npmjs.org/node-api-headers/-/node-api-headers-1.9.0.tgz, integrity
// sha512-2oNILP4jXwRB4ywnYKjVk1YyJ96n2D4EOVJO6S3oYZ5PtbJrw3Yt9TpAuX3nBLMuzn74rnfGQrv13pS9vC+YiA==.
// They are headers only: the addon resolves every `napi_*` symbol from the Bun process that
// loads it, so nothing from that package ends up inside the addon.

import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * The oldest macOS the addon must load on. Pinned rather than taken from the installed SDK, so
 * the same sources compile to the same Mach-O on every Mac that builds pico. It is well below
 * the app's deployment target: the CLI is not the app, and the Security and LocalAuthentication
 * calls here have been available since macOS 10.13.
 */
const DEPLOYMENT_TARGET = "13.0";

/** The addon's path in a checkout; `carried-keychain.ts` embeds exactly this file. */
function keychainAddonPath(repoRoot: string): string {
    return path.join(repoRoot, ".build", "keychain", "pico_keychain.node");
}

interface KeychainCompileInputs {
    /** Absolute repository root: the source, the headers and the output hang off it. */
    readonly repoRoot: string;
    readonly outfile: string;
    /** The macOS SDK `xcrun --show-sdk-path` prints. */
    readonly sdkPath: string;
    /** The Mach-O architecture to emit, as clang's `-arch` names it. */
    readonly architecture: string;
}

/** clang's arguments, in a fixed order, so one checkout's addon is another's byte for byte. */
function keychainCompilerArguments(inputs: KeychainCompileInputs): string[] {
    return [
        "clang",
        "-arch",
        inputs.architecture,
        `-mmacosx-version-min=${DEPLOYMENT_TARGET}`,
        "-isysroot",
        inputs.sdkPath,
        "-I",
        path.join(inputs.repoRoot, "native", "keychain", "include"),
        // Without this the checkout's absolute path reaches the Mach-O, and two machines
        // building the same commit would disagree.
        `-ffile-prefix-map=${inputs.repoRoot}=.`,
        "-std=c17",
        "-fobjc-arc",
        // Everything except the Node-API entry point, which carries its own default
        // visibility, stays private to the addon.
        "-fvisibility=hidden",
        "-O2",
        "-Wall",
        "-Wextra",
        // A `.node` addon is a loadable bundle, and `napi_*` is defined by whichever runtime
        // dlopens it, so those symbols are resolved at load time rather than at link time.
        "-bundle",
        "-Wl,-undefined,dynamic_lookup",
        "-framework",
        "Security",
        "-framework",
        "CoreFoundation",
        "-o",
        inputs.outfile,
        path.join(inputs.repoRoot, "native", "keychain", "pico_keychain.m"),
    ];
}

/** clang's name for the architecture Bun reports, or a refusal naming the odd one out. */
export function machOArchitecture(architecture: string): string {
    if (architecture === "arm64") return "arm64";
    if (architecture === "x64") return "x86_64";
    throw new Error(`pico's keychain bridge has no macOS build for ${architecture}`);
}

interface CommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}

async function capture(command: readonly string[]): Promise<CommandResult> {
    const child = Bun.spawn({ cmd: [...command], stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { exitCode: await child.exited, stdout, stderr };
}

/**
 * Compiles the bridge and returns its path. Always recompiles: a stale addon beside a changed
 * source is the one failure a build must not hand to the executable.
 */
export async function buildKeychain(repoRoot: string): Promise<string> {
    if (process.platform !== "darwin") {
        throw new Error(
            "pico's keychain bridge builds only on macOS: Keychain is a macOS credential store",
        );
    }

    const outfile = keychainAddonPath(repoRoot);
    await mkdir(path.dirname(outfile), { recursive: true });

    const sdk = await capture(["xcrun", "--sdk", "macosx", "--show-sdk-path"]);
    if (sdk.exitCode !== 0 || sdk.stdout.trim() === "") {
        throw new Error(`cannot locate the macOS SDK; is Xcode installed?\n${sdk.stderr.trim()}`);
    }

    const compile = await capture([
        "xcrun",
        ...keychainCompilerArguments({
            repoRoot,
            outfile,
            sdkPath: sdk.stdout.trim(),
            architecture: machOArchitecture(process.arch),
        }),
    ]);
    if (compile.exitCode !== 0) {
        throw new Error(`pico's keychain bridge failed to compile:\n${compile.stderr.trim()}`);
    }
    if (compile.stderr.trim()) process.stderr.write(compile.stderr);

    // The addon is the key to this user's credentials; nobody else needs to read it.
    await chmod(outfile, 0o700);
    return outfile;
}

if (import.meta.main) {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    try {
        process.stdout.write(`${await buildKeychain(repoRoot)}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}
