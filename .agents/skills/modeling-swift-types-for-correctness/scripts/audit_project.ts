#!/usr/bin/env bun
/**
 * Inventory current Swift 6 and iOS availability settings without modifying a project.
 *
 * The output is intentionally an inventory rather than a claim about resolved Xcode settings.
 * Target, configuration, xcconfig inclusion, and CI overrides can change the effective value.
 */

import { spawnSync } from "node:child_process";
import { type Dirent, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DESCRIPTION = `Inventory current Swift 6 and iOS availability settings without modifying a project.

The output is intentionally an inventory rather than a claim about resolved Xcode settings.
Target, configuration, xcconfig inclusion, and CI overrides can change the effective value.`;

const IGNORED_DIRECTORIES = [
    ".build",
    ".git",
    ".swiftpm",
    ".svn",
    "Build",
    "Carthage",
    "DerivedData",
    "Pods",
    "SourcePackages",
    "Vendor",
    "build",
    "node_modules",
];

const SETTING_NAMES = [
    "IPHONEOS_DEPLOYMENT_TARGET",
    "SWIFT_VERSION",
    "SWIFT_STRICT_CONCURRENCY",
    "SWIFT_DEFAULT_ACTOR_ISOLATION",
    "SWIFT_APPROACHABLE_CONCURRENCY",
    "SWIFT_STRICT_MEMORY_SAFETY",
    "BUILD_LIBRARY_FOR_DISTRIBUTION",
    "SDKROOT",
    "SUPPORTED_PLATFORMS",
    "OTHER_SWIFT_FLAGS",
];

const SETTING_PATTERN = new RegExp(
    `\\b(${SETTING_NAMES.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|` +
        "SWIFT_UPCOMING_FEATURE_[A-Z0-9_]+|SWIFT_EXPERIMENTAL_FEATURE_[A-Z0-9_]+)" +
        "\\s*=\\s*([^;\\n]+)",
    "g",
);
const TOOLS_VERSION_PATTERN = /^\s*\/\/\s*swift-tools-version\s*:\s*([^\s]+)/gm;
const SPM_IOS_PATTERN = /\.iOS\s*\(\s*(?:\.v(?<symbol>[0-9_]+)|["'](?<string>[0-9.]+)["'])\s*\)/g;
const SWIFT_SETTING_PATTERNS: [string, RegExp][] = [
    ["SwiftPM target default isolation", /\.defaultIsolation\s*\(\s*([^)]+)\)/g],
    ["SwiftPM upcoming feature", /\.enableUpcomingFeature\s*\(\s*["']([^"']+)["']\s*\)/g],
    ["SwiftPM experimental feature", /\.enableExperimentalFeature\s*\(\s*["']([^"']+)["']\s*\)/g],
    ["SwiftPM target language mode", /\.swiftLanguageMode\s*\(\s*([^)]+)\)/g],
    ["SwiftPM strict memory safety", /\.strictMemorySafety\s*\(/g],
];
const PACKAGE_LANGUAGE_MODES_PATTERN = /\bswiftLanguageModes\s*:\s*\[([^\]]+)\]/g;
const LEGACY_PACKAGE_LANGUAGE_VERSIONS_PATTERN = /\bswiftLanguageVersions\s*:\s*\[([^\]]+)\]/g;
const TOOLCHAIN_HINT_FILES = [".swift-version", ".tool-versions", "mise.toml"];
const SWIFT_VERSION_PATTERN = /\bSwift(?:\s+version)?\s+([0-9]+)\.([0-9]+)/;
// Fixture compilation, not production policy: the bundled fixtures were recorded
// against this compiler floor and prove nothing on anything older.
const FIXTURE_SWIFT_FLOOR: [number, number] = [6, 3];

/** Keys are written in sorted order so plain JSON.stringify stays byte-stable. */
export interface Finding {
    category: string;
    file: string;
    line: number;
    value: string;
}

export interface Toolchains {
    sdks: string | null;
    swift: string | null;
    xcode: string | null;
    xcode_swift: string | null;
}

export interface AuditReport {
    caveats: string[];
    containers: { swift_packages: string[]; xcode_projects: string[]; xcode_workspaces: string[] };
    current_swift_policy: { issues: string[]; language_mode: string; toolchain: string };
    files_scanned: number;
    findings: Finding[];
    root: string;
    toolchains: Toolchains;
    toolchains_checked: boolean;
}

export function commandOutput(command: string[]): string | null {
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf-8", timeout: 15_000 });
    // A missing tool, a spawn failure, and a timeout are all simply "no inventory".
    if (result.error !== undefined) {
        return null;
    }
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const output = (stdout !== "" ? stdout : stderr).trim();
    return output === "" ? null : output;
}

export function shouldSkip(relative: string): boolean {
    if (relative === "" || relative.startsWith("..")) {
        return true;
    }
    return relative.split(path.sep).some(part => IGNORED_DIRECTORIES.includes(part));
}

export interface WalkResult {
    files: string[];
    projects: string[];
    workspaces: string[];
    packages: string[];
}

/**
 * One pass collects every path the audit reports on. Ignored directories are pruned
 * rather than filtered afterwards; both yield the same set because any descendant of
 * an ignored directory is itself ignored.
 */
export function walkProject(root: string): WalkResult {
    const result: WalkResult = { files: [], projects: [], workspaces: [], packages: [] };
    const visit = (directory: string): void => {
        let entries: Dirent[];
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(root, absolute);
            if (shouldSkip(relative)) {
                continue;
            }
            if (entry.name.endsWith(".xcodeproj")) {
                result.projects.push(relative);
            } else if (entry.name.endsWith(".xcworkspace")) {
                result.workspaces.push(relative);
            }
            if (entry.name === "Package.swift") {
                result.packages.push(relative);
            }
            if (entry.isDirectory()) {
                // Symlinked directories are not followed, matching pathlib's rglob.
                visit(absolute);
                continue;
            }
            if (!isFile(absolute)) {
                continue;
            }
            const extension = path.extname(entry.name);
            if (
                entry.name === "Package.swift" ||
                extension === ".pbxproj" ||
                extension === ".xcconfig"
            ) {
                result.files.push(absolute);
            } else if (TOOLCHAIN_HINT_FILES.includes(entry.name)) {
                result.files.push(absolute);
            }
        }
    };
    visit(root);
    result.files.sort();
    result.projects.sort();
    result.workspaces.sort();
    result.packages.sort();
    return result;
}

function isFile(candidate: string): boolean {
    try {
        return statSync(candidate).isFile();
    } catch {
        return false;
    }
}

export function lineNumber(text: string, offset: number): number {
    let count = 1;
    for (let index = 0; index < offset; index += 1) {
        if (text[index] === "\n") {
            count += 1;
        }
    }
    return count;
}

export function normalizeSpmIos(groups: { symbol?: string; string?: string } | undefined): string {
    const symbol = groups?.symbol;
    if (symbol !== undefined && symbol !== "") {
        // `.v16_4` is spelled with an underscore in SwiftPM but reads as 16.4.
        return symbol.replaceAll("_", ".");
    }
    return groups?.string ?? "";
}

function collapseWhitespace(value: string): string {
    const trimmed = value.trim();
    return trimmed === "" ? "" : trimmed.split(/\s+/).join(" ");
}

export function scanText(text: string, name: string, relative: string): Finding[] {
    const findings: Finding[] = [];
    for (const match of text.matchAll(SETTING_PATTERN)) {
        findings.push({
            category: match[1],
            file: relative,
            line: lineNumber(text, match.index),
            value: match[2].trim().replace(/^"+|"+$/g, ""),
        });
    }

    if (name === "Package.swift") {
        for (const match of text.matchAll(TOOLS_VERSION_PATTERN)) {
            findings.push({
                category: "SwiftPM tools version",
                file: relative,
                line: lineNumber(text, match.index),
                value: match[1],
            });
        }
        for (const match of text.matchAll(SPM_IOS_PATTERN)) {
            findings.push({
                category: "SwiftPM iOS deployment target",
                file: relative,
                line: lineNumber(text, match.index),
                value: normalizeSpmIos(match.groups),
            });
        }
        for (const [category, pattern] of SWIFT_SETTING_PATTERNS) {
            for (const match of text.matchAll(pattern)) {
                // A pattern without a capture group records presence only.
                findings.push({
                    category,
                    file: relative,
                    line: lineNumber(text, match.index),
                    value: match[1] === undefined ? "enabled" : match[1].trim(),
                });
            }
        }
        const packagePatterns: [string, RegExp][] = [
            ["SwiftPM package language modes", PACKAGE_LANGUAGE_MODES_PATTERN],
            ["SwiftPM legacy package language versions", LEGACY_PACKAGE_LANGUAGE_VERSIONS_PATTERN],
        ];
        for (const [category, pattern] of packagePatterns) {
            for (const match of text.matchAll(pattern)) {
                findings.push({
                    category,
                    file: relative,
                    line: lineNumber(text, match.index),
                    value: collapseWhitespace(match[1]),
                });
            }
        }
    }

    if (TOOLCHAIN_HINT_FILES.includes(name)) {
        const compact = text
            .split(/\r\n|\r|\n/)
            .map(line => line.trim())
            .filter(line => line !== "")
            .join(" ");
        if (compact !== "") {
            findings.push({
                category: `Toolchain hint (${name})`,
                file: relative,
                line: 1,
                value: compact.slice(0, 500),
            });
        }
    }

    return findings;
}

export function scanFile(absolute: string, root: string): Finding[] {
    let text: string;
    try {
        text = readFileSync(absolute, { encoding: "utf-8" });
    } catch {
        return [];
    }
    return scanText(text, path.basename(absolute), path.relative(root, absolute));
}

export function swiftVersion(value: string): [number, number] | null {
    const match = SWIFT_VERSION_PATTERN.exec(value);
    if (match === null) {
        return null;
    }
    return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

export function currentSwiftPolicyIssues(toolchains: Toolchains): string[] {
    const issues: string[] = [];

    // Production language modes are inventory, not migration violations.
    // Only bundled-fixture toolchain compatibility is assessed here.

    const selected = toolchains.xcode_swift ?? toolchains.swift;
    if (selected !== null && selected !== "") {
        const version = swiftVersion(selected);
        if (
            version !== null &&
            (version[0] < FIXTURE_SWIFT_FLOOR[0] ||
                (version[0] === FIXTURE_SWIFT_FLOOR[0] && version[1] < FIXTURE_SWIFT_FLOOR[1]))
        ) {
            issues.push(
                `selected compiler is below the bundled fixtures' Swift 6.3 minimum: ${selected.split(/\r\n|\r|\n/)[0]}`,
            );
        }
    }

    return [...new Set(issues)].sort();
}

export function buildReport(
    root: string,
    options: { includeToolchains?: boolean } = {},
): AuditReport {
    const includeToolchains = options.includeToolchains !== false;
    const walked = walkProject(root);
    const findings: Finding[] = [];
    for (const file of walked.files) {
        findings.push(...scanFile(file, root));
    }

    const toolchains: Toolchains = {
        sdks: includeToolchains ? commandOutput(["xcodebuild", "-showsdks"]) : null,
        swift: includeToolchains ? commandOutput(["swift", "--version"]) : null,
        xcode: includeToolchains ? commandOutput(["xcodebuild", "-version"]) : null,
        xcode_swift: includeToolchains ? commandOutput(["xcrun", "swift", "--version"]) : null,
    };

    findings.sort((left, right) => {
        return (
            compareStrings(left.category, right.category) ||
            compareStrings(left.value, right.value) ||
            compareStrings(left.file, right.file) ||
            left.line - right.line
        );
    });

    return {
        caveats: [
            "These are textual findings, not fully resolved per-target/per-configuration build settings.",
            "Verify Xcode targets and schemes with xcodebuild -showBuildSettings on a machine with Xcode.",
            "Preserve the project-selected compiler and language mode. Bundled fixtures use Swift 6 language mode and require Swift 6.3+; consult references/swift-feature-status.md for the dated release snapshot.",
            "Deployment target, SDK/runtime availability, Swift semantic settings, and ABI policy remain independent axes.",
            "A declaration that compiles can still require an availability annotation or runtime fallback.",
            "This offline audit cannot determine whether the installed compiler is the newest release; verify the selected Xcode channel separately.",
        ],
        containers: {
            swift_packages: walked.packages,
            xcode_projects: walked.projects,
            xcode_workspaces: walked.workspaces,
        },
        current_swift_policy: {
            issues: currentSwiftPolicyIssues(toolchains),
            language_mode: "preserve project-supported modes; bundled fixtures use Swift 6",
            toolchain:
                "project-selected current Xcode/Swift compiler; bundled fixtures require Swift 6.3+",
        },
        files_scanned: walked.files.length,
        findings,
        root,
        toolchains,
        toolchains_checked: includeToolchains,
    };
}

function compareStrings(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

export function printHuman(report: AuditReport): void {
    console.log(`Project root: ${report.root}`);
    console.log(`Files scanned: ${report.files_scanned}`);

    console.log("\nToolchains");
    const checked = report.toolchains_checked;
    const toolchainKeys: (keyof Toolchains)[] = ["swift", "xcode_swift", "xcode", "sdks"];
    for (const key of toolchainKeys) {
        const value = report.toolchains[key];
        if (value !== null && value !== "") {
            const [first, ...rest] = value.split(/\r\n|\r|\n/);
            console.log(`  ${key}: ${first}`);
            for (const line of rest) {
                console.log(`         ${line}`);
            }
        } else if (checked) {
            console.log(`  ${key}: unavailable`);
        } else {
            console.log(`  ${key}: skipped`);
        }
    }

    console.log("\nCurrent Swift policy");
    const policy = report.current_swift_policy;
    console.log(`  toolchain: ${policy.toolchain}`);
    console.log(`  language mode: ${policy.language_mode}`);
    if (policy.issues.length > 0) {
        console.log("  issues:");
        for (const issue of policy.issues) {
            console.log(`    - ${issue}`);
        }
    } else {
        console.log("  issues: none detected in scanned declarations");
    }

    console.log("\nProject containers");
    const containers: [string, string[]][] = [
        ["xcode_projects", report.containers.xcode_projects],
        ["xcode_workspaces", report.containers.xcode_workspaces],
        ["swift_packages", report.containers.swift_packages],
    ];
    let anyContainer = false;
    for (const [category, values] of containers) {
        if (values.length > 0) {
            anyContainer = true;
            console.log(`  ${category.replaceAll("_", " ")}:`);
            for (const value of values) {
                console.log(`    - ${value}`);
            }
        }
    }
    if (!anyContainer) {
        console.log("  none found");
    }

    console.log("\nSettings and package declarations");
    if (report.findings.length === 0) {
        console.log("  none found");
    } else {
        let currentCategory: string | null = null;
        for (const item of report.findings) {
            if (item.category !== currentCategory) {
                console.log(`  ${item.category}:`);
                currentCategory = item.category;
            }
            console.log(`    - ${item.value}  (${item.file}:${item.line})`);
        }
    }

    console.log("\nCaveats");
    for (const caveat of report.caveats) {
        console.log(`  - ${caveat}`);
    }
}

const USAGE = `usage: audit_project.ts [-h] [--json] [--skip-toolchains] [root]

${DESCRIPTION}

positional arguments:
  root               Project or workspace root (default: current directory)

options:
  -h, --help         show this help message and exit
  --json             Emit machine-readable JSON
  --skip-toolchains  Skip invoking swift, xcrun, and xcodebuild; useful for
                     deterministic CI inventories`;

export interface AuditOptions {
    root: string;
    json: boolean;
    skipToolchains: boolean;
}

export function parseCommandLine(argv: string[]): AuditOptions | "help" {
    const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            json: { type: "boolean" },
            "skip-toolchains": { type: "boolean" },
        },
    });
    if (parsed.values.help === true) {
        return "help";
    }
    if (parsed.positionals.length > 1) {
        throw new Error(`unrecognized arguments: ${parsed.positionals.slice(1).join(" ")}`);
    }
    return {
        root: parsed.positionals[0] ?? ".",
        json: parsed.values.json === true,
        skipToolchains: parsed.values["skip-toolchains"] === true,
    };
}

export function main(argv: string[] = process.argv.slice(2)): number {
    let options: AuditOptions | "help";
    try {
        options = parseCommandLine(argv);
    } catch (error) {
        console.error(USAGE);
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
    if (options === "help") {
        console.log(USAGE);
        return 0;
    }
    const expanded =
        options.root === "~" || options.root.startsWith("~/")
            ? path.join(homedir(), options.root.slice(1))
            : options.root;
    const absolute = path.resolve(expanded);
    // Resolve symlinks like Path.resolve() so reported relative paths stay inside root.
    let root: string;
    try {
        root = realpathSync(absolute);
    } catch {
        root = absolute;
    }
    if (!isDirectory(root)) {
        console.error(`error: not a directory: ${root}`);
        return 2;
    }

    const report = buildReport(root, { includeToolchains: !options.skipToolchains });
    if (options.json) {
        // The report literal is written in sorted-key order, so this emits stable,
        // sorted JSON without a custom serializer.
        console.log(JSON.stringify(report, null, 2));
    } else {
        printHuman(report);
    }
    return 0;
}

function isDirectory(candidate: string): boolean {
    try {
        return statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = main();
}
