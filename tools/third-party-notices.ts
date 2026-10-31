import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** One package's entry in the generated `THIRD-PARTY-NOTICES.md`. */
export interface PackageNotice {
    readonly name: string;
    readonly version: string;
    /** The SPDX identifier the package declares, or `""` when it declares none. */
    readonly license: string;
    /** The package's license file, verbatim. */
    readonly licenseText: string;
    /** Where {@link licenseText} came from when the package ships no license file of its own. */
    readonly licenseTextSource?: string;
    /** Further notices the package ships, reproduced after its license. */
    readonly extraText?: string;
    /** The sentence introducing {@link extraText}. */
    readonly extraTextLead?: string;
}

/** Further notices to reproduce for one package root. */
export interface ExtraNotice {
    readonly extraTextFile: string;
    readonly extraTextLead: string;
}

/**
 * A license text Pico carries for a package that publishes none. Pinned to one version, so a
 * dependency bump cannot keep reusing text that was read for an older release.
 */
export interface LicenseOverride {
    readonly name: string;
    readonly version: string;
    /** Absolute path of the committed copy of that package's license. */
    readonly file: string;
    /** Where the copy was taken from, recorded in the generated file. */
    readonly sourceUrl: string;
}

// Oxfmt reflows prose, which would run a license's copyright lines together, so every license
// below is fenced. The paragraph about `adapter/` is the one this file carried before it was
// generated: it is the attribution those derived modules depend on.
export const NOTICES_PREAMBLE = `# Third-party notices

Pico's ACP adapter modules under \`adapter/\` are derived from oh-my-pi 18.14.0 (\`@oh-my-pi/pi-coding-agent\`) \`src/modes/acp/*\`, and each derived file names its source file in its first line.

\`tools/build-pico.ts\` generates this file from the \`pico\` build's metafile: every package below is compiled into the executable. Each license is reproduced from the package's own license file, with nothing changed but trailing whitespace, which this repository's formatter strips. Each one is kept in a code block, because the Markdown formatter reflows prose and would otherwise run its copyright lines together.

\`pico\` is a Bun single-file executable, so the Bun runtime is linked into it. Bun's section reproduces \`LICENSE.md\` from the \`bun-v<version>\` tag of <https://github.com/oven-sh/bun>, published as <https://bun.sh/docs/project/licensing>. It covers Bun's own MIT license, the statically linked LGPL-2 JavaScriptCore and WebKit, the other libraries Bun statically links, and the polyfills Bun embeds.
`;

/** `@oh-my-pi/pi-natives-darwin-arm64` lists the Rust crates linked into the addon here. */
export const NATIVE_ADDON_EXTRA_NOTICE: ExtraNotice = {
    extraTextFile: "THIRD-PARTY-NOTICES.txt",
    extraTextLead:
        "The addon is a compiled Rust library. The notices it ships for the code, data and fonts linked into it follow.",
};

const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;

function packageRootOf(absoluteInput: string): string | null {
    let segments = absoluteInput.split(path.sep);
    let marker = segments.lastIndexOf("node_modules");
    if (marker === -1) return null;
    let depth = segments[marker + 1]?.startsWith("@") ? 2 : 1;
    if (segments.length < marker + 1 + depth) return null;
    return segments.slice(0, marker + 1 + depth).join(path.sep);
}

/**
 * The package root of every bundled input that came from `node_modules`, deduplicated and
 * sorted. `baseDir` is the directory the metafile's relative input keys are resolved against,
 * which is the directory `Bun.build` ran in.
 */
export function bundledPackageRoots(inputs: Iterable<string>, baseDir: string): string[] {
    let roots = new Set<string>();
    for (let input of inputs) {
        let root = packageRootOf(path.resolve(baseDir, input));
        if (root !== null) roots.add(root);
    }
    return [...roots].sort();
}

// Verbatim, minus what would make two builds of the same tree differ or make this repository's
// own gate rewrite the committed file: a byte-order mark, CRLF line endings, trailing blank
// lines, and the trailing whitespace hk and Oxfmt strip. None of that is part of a license's
// terms, and keeping it would put the generator and the formatter in a standing argument.
export function normalizeLicenseText(text: string): string {
    return text
        .replace(/^\uFEFF/, "")
        .replaceAll("\r\n", "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\s+$/, "");
}

async function findLicenseFile(packageRoot: string): Promise<string | null> {
    let candidates: string[] = [];
    for (let entry of await readdir(packageRoot, { withFileTypes: true })) {
        if (entry.isFile() && LICENSE_FILE.test(entry.name)) candidates.push(entry.name);
    }
    if (candidates.length === 0) return null;
    // `LICENSE` beats `LICENSE-MIT` when a package ships both, and the rest is alphabetical so
    // that two builds of the same tree pick the same file.
    candidates.sort((a, b) => {
        let plainA = /^(licen[cs]e|copying)(\.(md|markdown|txt))?$/i.test(a) ? 0 : 1;
        let plainB = /^(licen[cs]e|copying)(\.(md|markdown|txt))?$/i.test(b) ? 0 : 1;
        return plainA - plainB || (a < b ? -1 : a > b ? 1 : 0);
    });
    return path.join(packageRoot, candidates[0] as string);
}

/** Section order in the generated file, and the order the build merges new notices into. */
export const byNameThenVersion = (a: PackageNotice, b: PackageNotice): number =>
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);

/**
 * Read one notice per package root, sorted by name. A package that ships no license file is
 * never guessed at: the whole collection fails, naming every such package, unless `overrides`
 * carries a committed copy of that exact version's license. An override for a package that does
 * ship a license file fails too, so a stale one can never hide the real text.
 */
export async function collectPackageNotices(
    packageRoots: readonly string[],
    extras: Readonly<Record<string, ExtraNotice>> = {},
    overrides: readonly LicenseOverride[] = [],
): Promise<PackageNotice[]> {
    let notices: PackageNotice[] = [];
    let unlicensed: string[] = [];
    let shadowed: string[] = [];
    let collected = new Set<string>();

    for (let packageRoot of packageRoots) {
        let manifest: unknown = JSON.parse(
            await readFile(path.join(packageRoot, "package.json"), "utf8"),
        );
        let fields = manifest as { name?: unknown; version?: unknown; license?: unknown };
        let name = typeof fields.name === "string" ? fields.name : path.basename(packageRoot);
        let version = typeof fields.version === "string" ? fields.version : "";
        let license = typeof fields.license === "string" ? fields.license : "";

        // A dependency tree installs the same release under several dependents. One section per
        // release says everything several identical ones would, and the roots arrive sorted, so
        // which copy is read never varies.
        if (collected.has(`${name}@${version}`)) continue;
        collected.add(`${name}@${version}`);

        let licenseFile = await findLicenseFile(packageRoot);
        let override = overrides.find(entry => entry.name === name && entry.version === version);
        if (licenseFile !== null && override !== undefined) {
            shadowed.push(`${name} ${version} (${licenseFile})`);
            continue;
        }
        if (licenseFile === null && override === undefined) {
            unlicensed.push(`${name} ${version} (${packageRoot})`);
            continue;
        }

        let source = override === undefined ? undefined : override.sourceUrl;
        let licenseText = normalizeLicenseText(
            await readFile(
                override === undefined ? (licenseFile as string) : override.file,
                "utf8",
            ),
        );
        let extra = extras[packageRoot];
        notices.push({
            name,
            version,
            license,
            licenseText,
            ...(source === undefined ? {} : { licenseTextSource: source }),
            ...(extra === undefined
                ? {}
                : {
                      extraText: normalizeLicenseText(
                          await readFile(path.join(packageRoot, extra.extraTextFile), "utf8"),
                      ),
                      extraTextLead: extra.extraTextLead,
                  }),
        });
    }

    if (shadowed.length > 0) {
        shadowed.sort();
        throw new Error(
            `These packages have a license override, but each ships its own license file, which is the only text that may be reproduced:\n${shadowed
                .map(entry => `  ${entry}`)
                .join("\n")}\nDrop the override.`,
        );
    }
    if (unlicensed.length > 0) {
        unlicensed.sort();
        throw new Error(
            `These packages are compiled into pico but ship no license file, so their notices cannot be written:\n${unlicensed
                .map(entry => `  ${entry}`)
                .join(
                    "\n",
                )}\nFind each package's license and decide what the notices must say; do not guess one.`,
        );
    }

    notices.sort(byNameThenVersion);
    return notices;
}

/** Render the committed file. Nothing here varies between two builds of the same tree. */
export function renderNotices(notices: readonly PackageNotice[]): string {
    let sections = notices.map(notice => {
        let heading = notice.license
            ? `Version ${notice.version} — ${notice.license}`
            : `Version ${notice.version}`;
        let body = [`\n## ${notice.name}\n`, `${heading}\n`];
        if (notice.licenseTextSource !== undefined) {
            body.push(
                `This package ships no license file. The text below is its project's license at the matching release, from <${notice.licenseTextSource}>.\n`,
            );
        }
        body.push("```text", notice.licenseText, "```\n");
        if (notice.extraText !== undefined) {
            body.push(`${notice.extraTextLead ?? ""}\n`, "```text", notice.extraText, "```\n");
        }
        return body.join("\n");
    });
    return NOTICES_PREAMBLE + sections.join("");
}

/** Why the committed notices no longer match the build, or `null` when they do. */
export function noticesDriftProblem(generated: string, committed: string | null): string | null {
    if (committed === generated) return null;
    let reason =
        committed === null
            ? "THIRD-PARTY-NOTICES.md does not exist"
            : "THIRD-PARTY-NOTICES.md no longer matches what pico bundles";
    return `${reason}. Rerun this build with --write-notices and commit the result.`;
}
