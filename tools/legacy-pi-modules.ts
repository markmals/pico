// Derived from oh-my-pi 18.14.0 scripts/legacy-pi-virtual-module.ts (MIT; see THIRD-PARTY-NOTICES.md).
//
// Oh My Pi generates this registry from its own monorepo, reading `packages/<dir>`. The
// published packages carry neither that layout nor the generator's dependencies, so this is the
// same derivation against `node_modules`. Keys, wildcard expansion and the lazy `import()`
// values have to match oh-my-pi's, because `src/extensibility/plugins/legacy-pi-compat.ts`
// serves every extension import out of exactly these keys inside a compiled binary.

import { readFile } from "node:fs/promises";
import path from "node:path";

/** The bare specifier oh-my-pi's compat plugin imports; this build resolves it in memory. */
export const LEGACY_PI_MODULES_SPECIFIER = "omp-legacy-pi-modules";

const VIRTUAL_NAMESPACE = "omp-legacy-pi-modules-build";

/**
 * How much of a package's root `./*` catch-all export enters the registry.
 * `null` keeps it out (coding-agent exposes `cli.ts`/`main.ts` there, which
 * would pull the binary entry's graph into the registry); `"flat"` takes only
 * top-level files; `"nested"` mirrors Node, where `*` also matches across `/`.
 */
type RootWildcard = "flat" | "nested" | null;

interface BundledPackage {
    readonly name: string;
    readonly identifier: string;
    readonly rootShim: string | null;
    readonly rootWildcard: RootWildcard;
}

/** The package whose `src/extensibility/` holds oh-my-pi's legacy compat shims. */
const SHIM_PACKAGE = "@oh-my-pi/pi-coding-agent";

const BUNDLED_PACKAGES: readonly BundledPackage[] = [
    {
        name: "@oh-my-pi/pi-agent-core",
        identifier: "PiAgentCore",
        rootShim: null,
        rootWildcard: null,
    },
    {
        name: "@oh-my-pi/pi-ai",
        identifier: "PiAi",
        rootShim: "legacy-pi-ai-shim.ts",
        rootWildcard: null,
    },
    { name: "@oh-my-pi/pi-catalog", identifier: "PiCatalog", rootShim: null, rootWildcard: "flat" },
    {
        name: "@oh-my-pi/pi-coding-agent",
        identifier: "PiCodingAgent",
        rootShim: "legacy-pi-coding-agent-shim.ts",
        rootWildcard: null,
    },
    { name: "@oh-my-pi/pi-natives", identifier: "PiNatives", rootShim: null, rootWildcard: null },
    // pi-tui keeps stateful singletons (`TERMINAL`, theme, figure settings) in
    // root-level and nested modules; extensions must share the host's records.
    {
        name: "@oh-my-pi/pi-tui",
        identifier: "PiTui",
        rootShim: "legacy-pi-tui-shim.ts",
        rootWildcard: "nested",
    },
    { name: "@oh-my-pi/pi-utils", identifier: "PiUtils", rootShim: null, rootWildcard: null },
];

// TypeBox has no package of its own in this dependency tree: oh-my-pi serves the key from its
// own facade, which keeps the legacy builders while producing omptype schemas.
const TYPEBOX_MODULE_KEY = "typebox";
const TYPEBOX_COMPAT_MODULE = "legacy-typebox.ts";
const MAIN_THREAD_UNSAFE_WILDCARD_BASENAMES = new Set(["worker-entry"]);

/** One namespace module the binary must retain for legacy extension imports. */
export interface BundledPiEntry {
    /** Canonical import key exposed to extensions. */
    readonly key: string;
    /** Unique identifier used by the virtual module's generated import. */
    readonly binding: string;
    /** Package or absolute source specifier compiled into the binary. */
    readonly importSpecifier: string;
}

interface WildcardPattern {
    readonly exportPrefix: string;
    readonly exportSuffix: string;
    readonly sourcePrefix: string;
    readonly sourceSuffix: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingForSubpath(identifier: string, subpath: string): string {
    let segments = subpath
        .split("/")
        .filter(Boolean)
        .map(segment =>
            segment
                .split(/[^a-zA-Z0-9]+/)
                .filter(Boolean)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join(""),
        );
    return `bundled${identifier}${segments.join("")}`;
}

function isSafeWildcardBasename(basename: string): boolean {
    if (!basename || basename.startsWith(".") || basename.startsWith("_")) return false;
    if (MAIN_THREAD_UNSAFE_WILDCARD_BASENAMES.has(basename)) return false;
    return !/\.(test|spec|d|d\.json|generated|bench)$/.test(basename);
}

function parseWildcardPattern(exportKey: string, sourcePattern: string): WildcardPattern | null {
    let exportStar = exportKey.indexOf("*");
    let sourceStar = sourcePattern.indexOf("*");
    if (exportStar === -1 || sourceStar === -1) return null;
    if (exportKey.indexOf("*", exportStar + 1) !== -1) return null;
    if (sourcePattern.indexOf("*", sourceStar + 1) !== -1) return null;
    if (!sourcePattern.startsWith("./")) return null;
    return {
        exportPrefix: exportKey.slice(2, exportStar),
        exportSuffix: exportKey.slice(exportStar + 1),
        sourcePrefix: sourcePattern.slice(2, sourceStar),
        sourceSuffix: sourcePattern.slice(sourceStar + 1),
    };
}

function exportImportTarget(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (isRecord(value) && typeof value.import === "string") return value.import;
    return null;
}

function isEnoent(error: unknown): boolean {
    return isRecord(error) && error.code === "ENOENT";
}

/**
 * Derive the bundled legacy Pi module surface from the installed packages' exports. Named
 * wildcard exports are expanded from source, including `x/index` spellings; root catch-alls
 * only per {@link BundledPackage.rootWildcard}.
 */
export async function collectBundledPiEntries(nodeModules: string): Promise<BundledPiEntry[]> {
    let shimDir = path.join(nodeModules, SHIM_PACKAGE, "src", "extensibility");
    let entries: BundledPiEntry[] = [];
    let seenKeys = new Set<string>();
    let seenBindings = new Set<string>();
    function addEntry(key: string, binding: string, importSpecifier: string): void {
        if (seenKeys.has(key)) return;
        if (seenBindings.has(binding)) {
            throw new Error(`Duplicate bundled Pi binding ${binding} for ${key}`);
        }
        seenKeys.add(key);
        seenBindings.add(binding);
        entries.push({ key, binding, importSpecifier });
    }

    for (let pkg of BUNDLED_PACKAGES) {
        let packageRoot = path.join(nodeModules, pkg.name);
        let manifestPath = path.join(packageRoot, "package.json");
        let manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
        if (!isRecord(manifest) || typeof manifest.name !== "string") {
            throw new Error(`Bundled Pi package manifest has no name: ${manifestPath}`);
        }
        let exportsField = isRecord(manifest.exports) ? manifest.exports : {};
        let rootSpecifier = pkg.rootShim ? path.join(shimDir, pkg.rootShim) : manifest.name;
        addEntry(manifest.name, `bundled${pkg.identifier}`, rootSpecifier);

        for (let exportKey in exportsField) {
            if (!exportKey.startsWith("./") || exportKey === "." || exportKey.includes("*"))
                continue;
            let subpath = exportKey.slice(2);
            let key = `${manifest.name}/${subpath}`;
            addEntry(key, bindingForSubpath(pkg.identifier, subpath), key);
        }

        for (let exportKey in exportsField) {
            if (!exportKey.startsWith("./") || exportKey === "." || !exportKey.includes("*"))
                continue;
            let sourcePattern = exportImportTarget(exportsField[exportKey]);
            if (!sourcePattern) continue;
            let pattern = parseWildcardPattern(exportKey, sourcePattern);
            if (!pattern || !/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(pattern.sourceSuffix))
                continue;
            let rootWildcard = pattern.exportPrefix === "" || pattern.exportPrefix === "/";
            if (rootWildcard && (exportKey !== "./*" || !pkg.rootWildcard)) continue;

            let sourceDir = path.join(packageRoot, pattern.sourcePrefix);
            try {
                // Recursive on purpose: Node matches `*` in an `exports` pattern across `/`, so
                // `./slash-commands/*` genuinely serves
                // `slash-commands/helpers/active-oauth-account`. Enumerating only the top level
                // leaves every nested key out of the compiled registry, where it falls through
                // to `Bun.resolveSync` and dies under bunfs — such an import would work from
                // source and fail inside the binary.
                let glob = new Bun.Glob(`**/*${pattern.sourceSuffix}`);
                let matches: string[] = [];
                for await (let match of glob.scan({ cwd: sourceDir, onlyFiles: true })) {
                    // Bun.Glob yields host separators; the export keys and generated
                    // identifiers below are `/`-shaped.
                    matches.push(match.split(path.sep).join("/"));
                }
                matches.sort();
                for (let match of matches) {
                    if (!match.endsWith(pattern.sourceSuffix)) continue;
                    if (rootWildcard && pkg.rootWildcard === "flat" && match.includes("/"))
                        continue;
                    let basename = match.slice(0, match.length - pattern.sourceSuffix.length);
                    let segments = basename.split("/");
                    // Every directory on the way has to be importable too: a private or hidden
                    // folder is no more exported than a private file.
                    if (
                        segments.some(segment => segment.startsWith(".") || segment.startsWith("_"))
                    ) {
                        continue;
                    }
                    if (!isSafeWildcardBasename(segments.at(-1) ?? "")) continue;
                    let subpath = `${pattern.exportPrefix}${basename}${pattern.exportSuffix}`;
                    let key = `${manifest.name}/${subpath}`;
                    addEntry(key, bindingForSubpath(pkg.identifier, subpath), key);
                }
            } catch (error) {
                if (!isEnoent(error)) throw error;
            }
        }
    }

    addEntry(TYPEBOX_MODULE_KEY, "bundledTypeBoxShim", path.join(shimDir, TYPEBOX_COMPAT_MODULE));
    return entries;
}

/** Render the lazy loader registry; exported so tests can read the generated module. */
export function renderLegacyPiVirtualModule(entries: readonly BundledPiEntry[]): string {
    let loaders = entries.map(
        entry => `const ${entry.binding} = () => import(${JSON.stringify(entry.importSpecifier)});`,
    );
    let modules = entries.map(entry => `\t${JSON.stringify(entry.key)}: ${entry.binding},`);
    return [
        ...loaders,
        "",
        "export const BUNDLED_PI_MODULE_LOADERS = {",
        ...modules,
        "};",
        "",
    ].join("\n");
}

/**
 * Build plugin that materializes the lazy legacy Pi module loaders entirely in memory. Literal
 * dynamic imports retain every compile-time edge without evaluating unrelated host modules
 * during extension bootstrap.
 */
export async function createLegacyPiVirtualModulePlugin(
    nodeModules: string,
): Promise<Bun.BunPlugin> {
    let source = renderLegacyPiVirtualModule(await collectBundledPiEntries(nodeModules));
    return {
        name: "pico:legacy-pi-modules",
        setup(build) {
            build.onResolve({ filter: /^omp-legacy-pi-modules$/ }, () => ({
                path: LEGACY_PI_MODULES_SPECIFIER,
                namespace: VIRTUAL_NAMESPACE,
            }));
            build.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, () => ({
                contents: source,
                loader: "ts",
            }));
        },
    };
}
