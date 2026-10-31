// The build Homebrew's `bun` runs. It compiles `adapter/pico.ts` into the single-file `pico`
// executable and writes the notices for everything that ended up inside it.
//
// Modelled on oh-my-pi 18.14.0 `scripts/compile-binary.ts` (MIT; see THIRD-PARTY-NOTICES.md):
// the same externals, the same `PI_COMPILED` define, the same bytecode and splitting. Its embed
// and docs steps read monorepo files the published packages do not ship, so they are not here,
// and the chunk naming differs for the reason given below.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createLegacyPiVirtualModulePlugin } from "./legacy-pi-modules.ts";
import {
    bundledPackageRoots,
    byNameThenVersion,
    collectPackageNotices,
    normalizeLicenseText,
    noticesDriftProblem,
    renderNotices,
    type PackageNotice,
} from "./third-party-notices.ts";

const USAGE = "usage: bun tools/build-pico.ts --outfile <path> [--write-notices]";

/** Native runtime dependencies pico resolves from an on-demand install, never embedded. */
const EXTERNAL_DEPENDENCIES = ["fastembed", "onnxruntime-node"];

/** The addon `adapter/carried-addon.ts` embeds; a file import, so no JS input names it. */
const NATIVE_ADDON_PACKAGE = "@oh-my-pi/pi-natives-darwin-arm64";

/** One row of {@link LICENSE_OVERRIDES}; `file` names a file in `tools/licenses/`. */
interface LicenseOverrideSource {
    readonly name: string;
    readonly version: string;
    readonly file: string;
    readonly sourceUrl: string;
}

/**
 * The packages pico bundles that publish no license file, and the copy of each one's license
 * that `tools/licenses/` carries. `tools/licenses/SOURCES.txt` records where each copy came
 * from. Every entry is pinned to one version: a dependency bump drops the override and the
 * build fails until someone reads the new release's license.
 */
const LICENSE_OVERRIDES: readonly LicenseOverrideSource[] = [
    {
        name: "@puppeteer/browsers",
        version: "3.0.6",
        file: "puppeteer-browsers-3.0.6.LICENSE.txt",
        sourceUrl: "https://github.com/puppeteer/puppeteer/blob/browsers-v3.0.6/LICENSE",
    },
    {
        name: "puppeteer-core",
        version: "25.3.0",
        file: "puppeteer-core-25.3.0.LICENSE.txt",
        sourceUrl: "https://github.com/puppeteer/puppeteer/blob/puppeteer-core-v25.3.0/LICENSE",
    },
];

/** The Bun version pinned in `mise.toml`'s `[tools]` table, or `null` when it pins none. */
export function pinnedBunVersion(miseToml: string): string | null {
    let inTools = false;
    for (let line of miseToml.split("\n")) {
        let trimmed = line.trim();
        // A table header ends the previous table, so `bun = …` under `[tasks."deps:install"]`
        // is never mistaken for the pin.
        if (trimmed.startsWith("[")) {
            inTools = trimmed === "[tools]";
            continue;
        }
        if (!inTools) continue;
        let match = /^bun\s*=\s*"([^"]+)"/.exec(trimmed);
        if (match?.[1] !== undefined) return match[1];
    }
    return null;
}

/**
 * Why this Bun must not build pico, or `null` when it may. Homebrew's `bun` formula runs this
 * build, and Homebrew core moves past the pinned version on its own schedule: a binary built by
 * an untested Bun must fail here rather than ship. Patch releases pass, because the pin and the
 * formula only ever agree to that precision.
 */
export function bunVersionProblem(running: string, miseToml: string): string | null {
    let pinned = pinnedBunVersion(miseToml);
    if (pinned === null) {
        return "mise.toml pins no Bun in its [tools] table, so there is no tested Bun to build pico with.";
    }
    if (running.split(".", 2).join(".") !== pinned.split(".", 2).join(".")) {
        return `pico is built with Bun ${pinned}, the version mise.toml pins, and this Bun is ${running}. Bun's bundler and its single-file executable format change between minor versions, so this build stops rather than ship an untested binary. Install Bun ${pinned}, or move the mise.toml pin and retest the executable.`;
    }
    return null;
}

export interface PicoBuildOptions {
    /** Absolute repository root: module resolution, `node_modules` and output paths hang off it. */
    readonly repoRoot: string;
    /** Absolute entry point compiled into the executable. */
    readonly entrypoint: string;
    /** Absolute path of the executable to write. */
    readonly outfile: string;
}

/**
 * Compile the executable and return the build's metafile, which names every bundled input and
 * is therefore the only honest source for the third-party notices.
 */
export async function compilePico(options: PicoBuildOptions): Promise<Bun.BuildMetafile> {
    let nodeModules = path.join(options.repoRoot, "node_modules");
    await mkdir(path.dirname(options.outfile), { recursive: true });

    // Bun ad-hoc signs the Mach-O it writes. BUN_NO_CODESIGN_MACHO_BINARY stays unset: pico has
    // no Developer ID to re-sign with, and the tap's formula checks `codesign --verify`.
    let output = await Bun.build({
        entrypoints: [options.entrypoint],
        root: options.repoRoot,
        external: EXTERNAL_DEPENDENCIES,
        define: { "process.env.PI_COMPILED": JSON.stringify("true") },
        // Precompiled bytecode skips parsing the bundle at boot, at the cost of binary size.
        // Keep `import.meta.resolve` in bundled dependencies valid under bytecode.
        format: "esm",
        bytecode: true,
        splitting: true,
        // Oh My Pi names chunks `chunks/[name]-[hash].[ext]`. Pico's graph is the adapter's, not
        // the whole CLI's, so several type-only modules reach the bundler as separate chunks with
        // identical (empty) contents, and that template makes Bun refuse the build. `[dir]` is the
        // chunk's source directory, which tells `render/types` from `dap/types`.
        naming: { chunk: "chunks/[dir]/[name]-[hash].[ext]" },
        minify: { identifiers: false, keepNames: true },
        plugins: [await createLegacyPiVirtualModulePlugin(nodeModules)],
        metafile: true,
        compile: {
            outfile: options.outfile,
            autoloadBunfig: false,
            autoloadDotenv: false,
            autoloadTsconfig: false,
            autoloadPackageJson: false,
        },
        throw: false,
    });

    if (!output.success) {
        throw new Error(`pico's bundle failed:\n${output.logs.map(log => log.message).join("\n")}`);
    }
    if (output.metafile === undefined) {
        throw new Error(
            "Bun.build returned no metafile, so pico's third-party notices cannot be generated.",
        );
    }
    return output.metafile;
}

export interface NoticesInputs {
    readonly repoRoot: string;
    /** The directory the metafile's relative input keys are resolved against. */
    readonly baseDir: string;
    readonly metafile: Bun.BuildMetafile;
    /** The Bun version the notices name; the pin, so a patch release changes nothing. */
    readonly bunVersion: string;
}

/** Render `THIRD-PARTY-NOTICES.md` for one build. */
export async function noticesForBuild(inputs: NoticesInputs): Promise<string> {
    let roots = bundledPackageRoots(Object.keys(inputs.metafile.inputs), inputs.baseDir);

    // The addon is embedded as a file rather than imported as JavaScript, so it is listed here
    // in its own right; its `THIRD-PARTY-NOTICES.txt` carries the Rust crates linked into it.
    let addonRoot = path.join(inputs.repoRoot, "node_modules", NATIVE_ADDON_PACKAGE);
    if (!roots.includes(addonRoot)) roots.push(addonRoot);
    roots.sort();

    let notices = await collectPackageNotices(
        roots,
        LICENSE_OVERRIDES.map(override => ({
            ...override,
            file: path.join(import.meta.dirname, "licenses", override.file),
        })),
    );

    // Bun is linked into every compiled executable, and no metafile input names it.
    let bunNotice: PackageNotice = {
        name: "Bun",
        version: inputs.bunVersion,
        license: "MIT",
        licenseText: normalizeLicenseText(
            await readFile(path.join(import.meta.dirname, "bun-license.txt"), "utf8"),
        ),
    };
    return renderNotices([...notices, bunNotice].sort(byNameThenVersion));
}

function fail(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

interface Arguments {
    readonly outfile: string;
    readonly writeNotices: boolean;
}

function parseArguments(argv: readonly string[]): Arguments | string {
    let outfile: string | null = null;
    let writeNotices = false;
    for (let index = 0; index < argv.length; index += 1) {
        let argument = argv[index] as string;
        if (argument === "--write-notices") {
            writeNotices = true;
        } else if (argument === "--outfile") {
            index += 1;
            let value = argv[index];
            if (value === undefined) return USAGE;
            outfile = value;
        } else if (argument.startsWith("--outfile=")) {
            outfile = argument.slice("--outfile=".length);
        } else {
            return USAGE;
        }
    }
    if (outfile === null || outfile === "") return USAGE;
    return { outfile, writeNotices };
}

async function main(): Promise<void> {
    let parsed = parseArguments(process.argv.slice(2));
    if (typeof parsed === "string") fail(parsed);

    let repoRoot = path.resolve(import.meta.dirname, "..");
    let miseToml = await readFile(path.join(repoRoot, "mise.toml"), "utf8");
    let problem = bunVersionProblem(Bun.version, miseToml);
    if (problem !== null) fail(problem);

    let outfile = path.resolve(process.cwd(), parsed.outfile);
    let metafile = await compilePico({
        repoRoot,
        entrypoint: path.join(repoRoot, "adapter", "pico.ts"),
        outfile,
    });

    let generated = await noticesForBuild({
        repoRoot,
        baseDir: process.cwd(),
        metafile,
        bunVersion: pinnedBunVersion(miseToml) as string,
    });

    let noticesPath = path.join(repoRoot, "THIRD-PARTY-NOTICES.md");
    if (parsed.writeNotices) {
        await writeFile(noticesPath, generated);
    } else {
        let committed = await readFile(noticesPath, "utf8").catch(() => null);
        let drift = noticesDriftProblem(generated, committed);
        if (drift !== null) fail(drift);
    }

    process.stdout.write(`${outfile} (${(await stat(outfile)).size} bytes)\n`);
}

if (import.meta.main) await main();
