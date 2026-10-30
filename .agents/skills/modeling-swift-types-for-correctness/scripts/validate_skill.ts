#!/usr/bin/env bun
/** Validate this Agent Skill's metadata, links, evals, and Swift fixtures. */

import { spawnSync } from "node:child_process";
import {
    type Dirent,
    accessSync,
    constants,
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DESCRIPTION =
    "Validate this Agent Skill's metadata, links, evals, and Swift fixtures.";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKDOWN_LINK_PATTERN = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
const REQUIRED_PATHS = [
    "SKILL.md",
    "references/decision-guide.md",
    "references/compile-check-runner.md",
    "references/algebraic-and-refined-values.md",
    "references/identity-typestate-capabilities.md",
    "references/ui-state-navigation-and-effects.md",
    "references/advanced-generics-and-protocols.md",
    "references/ownership-concurrency-errors.md",
    "references/boundaries-and-interop.md",
    "references/security-and-resource-modeling.md",
    "references/ios-versioning.md",
    "references/testing-migration-and-review.md",
    "references/sources.md",
    "examples/CorePatterns.swift",
    "examples/CorePatternsRuntimeChecks.swift",
    "examples/CurrentSwiftPatterns.swift",
    "examples/TrustStatePatterns.swift",
    "examples/compile-checks.json",
    "examples/CompileFailWrongID.swift",
    "examples/CompileFailBypassValidation.swift",
    "examples/CompileFailUseAfterConsume.swift",
    "examples/CompileFailWrongTypestate.swift",
    "examples/CompileFailWrongTrustState.swift",
    "scripts/audit_project.ts",
    "scripts/check_examples.ts",
    "scripts/swift_compile_checks.ts",
    "scripts/validate_skill.ts",
    "evals/trigger-evals.json",
    "evals/quality-evals.md",
];
const SCRIPT_PATHS = [
    "scripts/check_examples.ts",
    "scripts/audit_project.ts",
    "scripts/swift_compile_checks.ts",
    "scripts/validate_skill.ts",
];
const REFERENCE_MAX_LINES = 500;
const PROSE_SUFFIXES = [".md", ".swift", ".ts", ".yaml", ".json"];

export type FrontmatterValue = string | Record<string, string>;
export type Frontmatter = Record<string, FrontmatterValue>;

export class Validation {
    readonly errors: string[] = [];
    readonly warnings: string[] = [];

    error(message: string): void {
        this.errors.push(message);
    }

    warn(message: string): void {
        this.warnings.push(message);
    }
}

function isMapping(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitLines(text: string): string[] {
    return text.split(/\r\n|\r|\n/);
}

export function parseScalar(raw: string): string {
    const value = raw.trim();
    if (
        value.length >= 2 &&
        value[0] === value[value.length - 1] &&
        (value[0] === '"' || value[0] === "'")
    ) {
        return value.slice(1, -1);
    }
    return value;
}

/**
 * Parse the narrow YAML subset used by this SKILL.md.
 *
 * Scalars, folded/literal blocks, and one nested mapping level are everything the
 * bundled frontmatter uses; anything outside that subset raises rather than being
 * silently accepted.
 */
export function minimalFrontmatterParse(text: string): Frontmatter {
    const lines = splitLines(text);
    const result: Frontmatter = {};
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === "" || line.trimStart().startsWith("#")) {
            index += 1;
            continue;
        }
        if (line.startsWith(" ") || !line.includes(":")) {
            throw new Error(`unsupported frontmatter syntax at line ${index + 1}`);
        }
        const separator = line.indexOf(":");
        const key = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        if (raw === ">" || raw === ">-" || raw === "|" || raw === "|-") {
            index += 1;
            const parts: string[] = [];
            while (
                index < lines.length &&
                (lines[index].startsWith("  ") || lines[index].trim() === "")
            ) {
                parts.push(lines[index].trim());
                index += 1;
            }
            result[key] = parts.filter(part => part !== "").join(" ");
            continue;
        }
        if (raw === "") {
            index += 1;
            const mapping: Record<string, string> = {};
            while (index < lines.length && lines[index].startsWith("  ")) {
                const child = lines[index].trim();
                if (!child.includes(":")) {
                    throw new Error(`unsupported mapping syntax at line ${index + 1}`);
                }
                const childSeparator = child.indexOf(":");
                mapping[child.slice(0, childSeparator).trim()] = parseScalar(
                    child.slice(childSeparator + 1),
                );
                index += 1;
            }
            result[key] = mapping;
            continue;
        }
        result[key] = parseScalar(raw);
        index += 1;
    }
    return result;
}

export function readFrontmatter(skillPath: string, validation: Validation): [Frontmatter, string] {
    const text = readFileSync(skillPath, { encoding: "utf-8" });
    const lines = splitLines(text);
    if (lines.length === 0 || lines[0].trim() !== "---") {
        validation.error("SKILL.md must begin with YAML frontmatter");
        return [{}, text];
    }
    const end = lines.findIndex((line, index) => index >= 1 && line.trim() === "---");
    if (end < 0) {
        validation.error("SKILL.md frontmatter is not closed with ---");
        return [{}, text];
    }
    const raw = lines.slice(1, end).join("\n");
    try {
        return [minimalFrontmatterParse(raw), text];
    } catch (error) {
        validation.error(
            `invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [{}, text];
    }
}

export function validateFrontmatter(root: string, validation: Validation): void {
    const [data, text] = readFrontmatter(path.join(root, "SKILL.md"), validation);
    if (Object.keys(data).length === 0) {
        return;
    }

    const allowed = [
        "name",
        "description",
        "license",
        "compatibility",
        "metadata",
        "allowed-tools",
    ];
    const unknown = Object.keys(data)
        .filter(key => !allowed.includes(key))
        .sort();
    if (unknown.length > 0) {
        validation.error(`unsupported frontmatter field(s): ${unknown.join(", ")}`);
    }

    const name = data.name;
    if (typeof name !== "string" || name === "") {
        validation.error("frontmatter name must be a nonempty string");
    } else {
        if (name.length > 64) {
            validation.error(`frontmatter name exceeds 64 characters (${name.length})`);
        }
        if (!NAME_PATTERN.test(name)) {
            validation.error(
                "frontmatter name must use lowercase letters, digits, and single hyphens",
            );
        }
        if (name !== path.basename(root)) {
            validation.error(
                `frontmatter name '${name}' must match directory '${path.basename(root)}'`,
            );
        }
    }

    const description = data.description;
    if (typeof description !== "string" || description.trim() === "") {
        validation.error("frontmatter description must be a nonempty string");
    } else if (description.length > 1024) {
        validation.error(`frontmatter description exceeds 1024 characters (${description.length})`);
    }

    const compatibility = data.compatibility;
    if (compatibility !== undefined) {
        if (typeof compatibility !== "string") {
            validation.error("frontmatter compatibility must be a string");
        } else if (compatibility.length > 500) {
            validation.error(
                `frontmatter compatibility exceeds 500 characters (${compatibility.length})`,
            );
        }
    }

    const metadata = data.metadata;
    if (metadata !== undefined && typeof metadata !== "object") {
        validation.error("frontmatter metadata must be a mapping");
    }

    const lineCount = splitLines(text).length;
    if (lineCount > 500) {
        validation.error(
            `SKILL.md has ${lineCount} lines; keep it at or below 500 for progressive disclosure`,
        );
    }
}

export function localTarget(link: string): string | null {
    const stripped = link.trim().replace(/^[<>]+|[<>]+$/g, "");
    if (
        stripped === "" ||
        stripped.startsWith("http://") ||
        stripped.startsWith("https://") ||
        stripped.startsWith("mailto:") ||
        stripped.startsWith("#")
    ) {
        return null;
    }
    const withoutFragment = stripped.split("#", 1)[0].split("?", 1)[0];
    if (withoutFragment === "") {
        return null;
    }
    try {
        return decodeURIComponent(withoutFragment) || null;
    } catch {
        // A link that is not valid percent-encoding is still a local path candidate.
        return withoutFragment;
    }
}

export function validateLinks(root: string, validation: Validation): void {
    // A bundled skill may route to a sibling in the same independently usable plugin.
    const linkRoot = path.basename(path.dirname(root)) === "skills" ? path.dirname(root) : root;
    for (const source of markdownFiles(root)) {
        const text = readFileSync(source, { encoding: "utf-8" });
        for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
            const targetText = localTarget(match[1]);
            if (targetText === null) {
                continue;
            }
            const target = path.resolve(path.dirname(source), targetText);
            const relativeToRoot = path.relative(path.resolve(linkRoot), target);
            if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
                validation.error(
                    `${path.relative(root, source)} links outside the skill or its bundled siblings: ${match[1]}`,
                );
                continue;
            }
            if (!existsSync(target)) {
                const line = countLines(text, match.index);
                validation.error(
                    `broken local link in ${path.relative(root, source)}:${line}: ${match[1]}`,
                );
            }
        }
    }
}

function countLines(text: string, offset: number): number {
    let count = 1;
    for (let index = 0; index < offset; index += 1) {
        if (text[index] === "\n") {
            count += 1;
        }
    }
    return count;
}

export function validateRequiredPaths(root: string, validation: Validation): void {
    for (const relative of REQUIRED_PATHS) {
        if (!isFile(path.join(root, relative))) {
            validation.error(`missing required file: ${relative}`);
        }
    }
}

export function validateReferenceStructure(root: string, validation: Validation): void {
    const skillPath = path.join(root, "SKILL.md");
    const referenceRoot = path.join(root, "references");
    if (!existsSync(skillPath) || !isDirectory(referenceRoot)) {
        return;
    }

    const skillText = readFileSync(skillPath, { encoding: "utf-8" });
    const references = readdirSync(referenceRoot)
        .filter(name => name.endsWith(".md"))
        .sort();
    for (const name of references) {
        const relative = `references/${name}`;
        if (!skillText.includes(`](${relative})`)) {
            validation.error(`reference is not directly linked from SKILL.md: ${relative}`);
        }
        const lineCount = splitLines(
            readFileSync(path.join(referenceRoot, name), { encoding: "utf-8" }),
        ).length;
        if (lineCount > REFERENCE_MAX_LINES) {
            validation.error(
                `${relative} has ${lineCount} lines; split focused references at ${REFERENCE_MAX_LINES} lines`,
            );
        }
    }
}

export function validateMetadata(root: string, validation: Validation): void {
    const skillPath = path.join(root, "SKILL.md");
    if (!existsSync(skillPath)) {
        return;
    }
    const [data] = readFrontmatter(skillPath, validation);
    const metadata = data.metadata;
    if (typeof metadata !== "object") {
        return;
    }

    const version = metadata.version;
    const verified = metadata["last-verified"];
    const swiftBaseline = metadata["swift-baseline"];
    const swiftLanguageMode = metadata["swift-language-mode"];
    if (
        typeof version === "string" &&
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
    ) {
        validation.error("metadata.version must use semantic-version syntax");
    }
    if (typeof verified === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
        validation.error("metadata.last-verified must use YYYY-MM-DD");
    }
    if (swiftBaseline !== "6.3+") {
        validation.error(
            "metadata.swift-baseline must match the bundled fixture compiler floor: 6.3+",
        );
    }
    if (swiftLanguageMode !== "6") {
        validation.error("metadata.swift-language-mode must be 6");
    }
}

export function validateQualityEvals(root: string, validation: Validation): void {
    const evalPath = path.join(root, "evals/quality-evals.md");
    if (!existsSync(evalPath)) {
        return;
    }
    const text = readFileSync(evalPath, { encoding: "utf-8" });
    const scenarios = text.match(/^##\s+\d+\./gm) ?? [];
    if (scenarios.length < 10) {
        validation.warn(
            `only ${scenarios.length} quality eval scenarios; broad skills benefit from at least 10`,
        );
    }
    for (const required of ["**Prompt**", "**Must include**", "**Must not include**"]) {
        if (!text.includes(required)) {
            validation.error(`quality-evals.md is missing required section marker: ${required}`);
        }
    }
}

export function validateCompileManifest(root: string, validation: Validation): void {
    const manifestPath = path.join(root, "examples/compile-checks.json");
    if (!existsSync(manifestPath)) {
        return;
    }
    let data: unknown;
    try {
        data = JSON.parse(readFileSync(manifestPath, { encoding: "utf-8" }));
    } catch (error) {
        validation.error(
            `invalid compile-check manifest: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
    }
    if (!isMapping(data)) {
        validation.error("compile-check manifest root must be an object");
        return;
    }
    const compilerArguments = data.compiler_arguments;
    const supportSources = data.support_sources;
    const argumentList = Array.isArray(compilerArguments) ? compilerArguments : null;
    if (argumentList === null || !argumentList.includes("-emit-module")) {
        validation.error(
            "compile-check manifest must use the emit-module ownership-checking phase",
        );
    }
    if (data.minimum_swift_version !== "6.3") {
        validation.error(
            "compile-check manifest must retain its Swift 6.3 minimum compiler requirement",
        );
    }
    if (!Array.isArray(supportSources) || supportSources.length === 0) {
        validation.error(
            "compile-check manifest must compile fixtures with shared production sources",
        );
    }
    if (
        argumentList === null ||
        !["-swift-version", "6", "-strict-concurrency=complete"].every(required =>
            argumentList.includes(required),
        )
    ) {
        validation.error(
            "compile-check manifest must compile fixtures in Swift 6 strict-concurrency mode",
        );
    }

    const controls = data.positive_controls;
    const negatives = data.negative_fixtures;
    if (!Array.isArray(controls) || !Array.isArray(negatives)) {
        validation.error(
            "compile-check manifest must declare positive_controls and negative_fixtures",
        );
        return;
    }
    const controlNames = new Set<string>();
    for (const item of controls) {
        if (isMapping(item) && typeof item.name === "string") {
            controlNames.add(item.name);
        }
    }
    const declaredNegativeSources = new Set<string>();
    for (const fixture of negatives) {
        if (!isMapping(fixture)) {
            validation.error("each negative fixture must be an object");
            continue;
        }
        const fixtureName =
            typeof fixture.name === "string" ? `'${fixture.name}'` : String(fixture.name);
        const sources = fixture.sources;
        if (!Array.isArray(sources) || sources.length === 0) {
            validation.error(`negative fixture ${fixtureName} must declare its misuse source`);
            continue;
        }
        for (const source of sources) {
            if (typeof source === "string" && path.basename(source).startsWith("CompileFail")) {
                declaredNegativeSources.add(source);
            }
        }
        const markers = fixture.diagnostic_markers;
        if (
            !Array.isArray(markers) ||
            markers.length === 0 ||
            markers.some(item => typeof item !== "string" || item === "")
        ) {
            validation.error(`negative fixture ${fixtureName} must declare diagnostic markers`);
        }
        if (
            typeof fixture.positive_control !== "string" ||
            !controlNames.has(fixture.positive_control)
        ) {
            validation.error(
                `negative fixture ${fixtureName} has no valid paired positive control`,
            );
        }
    }

    // A fixture on disk that no manifest entry claims would never be compiled, and a
    // claimed fixture that is missing would silently drop its evidence.
    const diskSources = readdirSync(path.join(root, "examples")).filter(
        name => name.startsWith("CompileFail") && name.endsWith(".swift"),
    );
    const declared = [...declaredNegativeSources].sort();
    const disk = [...diskSources].sort();
    if (declared.length !== disk.length || declared.some((name, index) => name !== disk[index])) {
        validation.error(
            "compile-check manifest fixture set differs from disk: " +
                `declared=${JSON.stringify(declared)}, disk=${JSON.stringify(disk)}`,
        );
    }
}

export function validateScriptPermissions(root: string, validation: Validation): void {
    for (const relative of SCRIPT_PATHS) {
        const scriptPath = path.join(root, relative);
        if (existsSync(scriptPath) && (statSync(scriptPath).mode & 0o111) === 0) {
            validation.warn(`script is not executable: ${relative}`);
        }
    }
}

export function validateTriggerEvals(root: string, validation: Validation): void {
    const evalPath = path.join(root, "evals/trigger-evals.json");
    if (!existsSync(evalPath)) {
        return;
    }
    let data: unknown;
    try {
        data = JSON.parse(readFileSync(evalPath, { encoding: "utf-8" }));
    } catch (error) {
        validation.error(
            `invalid trigger eval JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
    }
    if (!isMapping(data) || !Array.isArray(data.cases)) {
        validation.error("trigger-evals.json must contain a cases array");
        return;
    }
    const cases = data.cases;
    const seenIds = new Set<string>();
    const decisions = new Set<boolean>();
    cases.forEach((item: unknown, index: number) => {
        const label = `trigger eval case ${index + 1}`;
        if (!isMapping(item)) {
            validation.error(`${label} must be an object`);
            return;
        }
        const identifier = item.id;
        const prompt = item.prompt;
        const shouldTrigger = item.should_trigger;
        const reason = item.reason;
        if (typeof identifier !== "string" || identifier === "") {
            validation.error(`${label} has no valid id`);
        } else if (seenIds.has(identifier)) {
            validation.error(`duplicate trigger eval id: ${identifier}`);
        } else {
            seenIds.add(identifier);
        }
        if (typeof prompt !== "string" || prompt.trim() === "") {
            validation.error(`${label} has no prompt`);
        }
        if (typeof shouldTrigger !== "boolean") {
            validation.error(`${label} should_trigger must be Boolean`);
        } else {
            decisions.add(shouldTrigger);
        }
        if (typeof reason !== "string" || reason.trim() === "") {
            validation.error(`${label} has no reason`);
        }
    });
    if (!decisions.has(true) || !decisions.has(false)) {
        validation.error("trigger evals must contain both positive and negative cases");
    }
    if (cases.length < 12) {
        validation.warn(
            `only ${cases.length} trigger evals; broad skills benefit from at least 12`,
        );
    }
}

const AUDIT_FIXTURE_PACKAGE = `// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "AuditFixture",
    platforms: [.iOS(.v16)],
    targets: [
        .target(
            name: "AuditFixture",
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .defaultIsolation(MainActor.self),
                .enableUpcomingFeature("InferSendableFromCaptures"),
                .enableExperimentalFeature("ExampleFeature"),
                .strictMemorySafety(),
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
`;

const AUDIT_FIXTURE_XCCONFIG = `IPHONEOS_DEPLOYMENT_TARGET = 16.0
SWIFT_VERSION = 6.0
SWIFT_APPROACHABLE_CONCURRENCY = YES
SWIFT_STRICT_MEMORY_SAFETY = YES
BUILD_LIBRARY_FOR_DISTRIBUTION = YES
SDKROOT = iphoneos
`;

const AUDIT_EXPECTED_FINDINGS: [string, string][] = [
    ["SwiftPM tools version", "6.3"],
    ["SwiftPM iOS deployment target", "16"],
    ["SwiftPM package language modes", ".v6"],
    ["SwiftPM target language mode", ".v6"],
    ["SwiftPM target default isolation", "MainActor.self"],
    ["SwiftPM upcoming feature", "InferSendableFromCaptures"],
    ["SwiftPM experimental feature", "ExampleFeature"],
    ["SwiftPM strict memory safety", "enabled"],
    ["SWIFT_VERSION", "6.0"],
    ["SWIFT_APPROACHABLE_CONCURRENCY", "YES"],
    ["SWIFT_STRICT_MEMORY_SAFETY", "YES"],
    ["BUILD_LIBRARY_FOR_DISTRIBUTION", "YES"],
    ["SDKROOT", "iphoneos"],
];

export function validateAuditScript(root: string, validation: Validation): void {
    const script = path.join(root, "scripts/audit_project.ts");
    if (!existsSync(script)) {
        return;
    }

    const fixture = mkdtempSync(path.join(tmpdir(), "skill-audit-fixture-"));
    let code: number;
    let output: string;
    try {
        writeFileSync(path.join(fixture, "Package.swift"), AUDIT_FIXTURE_PACKAGE, {
            encoding: "utf-8",
        });
        writeFileSync(path.join(fixture, "Compatibility.xcconfig"), AUDIT_FIXTURE_XCCONFIG, {
            encoding: "utf-8",
        });
        [code, output] = runCommand(
            [process.execPath, script, fixture, "--json", "--skip-toolchains"],
            root,
        );
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }

    if (code !== 0) {
        validation.error(`project-audit self-test failed:\n${output}`);
        return;
    }
    let report: unknown;
    try {
        report = JSON.parse(output);
    } catch (error) {
        validation.error(
            `project-audit self-test returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
    }
    if (!isMapping(report) || !Array.isArray(report.findings)) {
        validation.error("project-audit self-test returned invalid JSON: missing findings");
        return;
    }
    if (report.toolchains_checked !== false) {
        validation.error("project-audit self-test did not report skipped toolchain checks");
    }
    const policy = report.current_swift_policy;
    if (!isMapping(policy) || !Array.isArray(policy.issues) || policy.issues.length !== 0) {
        validation.error(
            `project-audit self-test reported unexpected Swift-policy issues: ${JSON.stringify(policy)}`,
        );
    }

    const observed = new Set<string>();
    for (const item of report.findings) {
        if (isMapping(item)) {
            observed.add(JSON.stringify([item.category, item.value]));
        }
    }
    const missing = AUDIT_EXPECTED_FINDINGS.filter(pair => !observed.has(JSON.stringify(pair)))
        .map(pair => `(${pair[0]}, ${pair[1]})`)
        .sort();
    if (missing.length > 0) {
        validation.error(
            `project-audit self-test missed expected findings: [${missing.join(", ")}]`,
        );
    }
}

export function validateCurrentSwiftPolicy(root: string, validation: Validation): void {
    // Do not enforce a consumer project's language mode through prose strings
    // or ban references to supported older modes. Fixture requirements live in
    // their compile manifest; this check verifies only the helper delegation.
    const checkScript = path.join(root, "scripts/check_examples.ts");
    if (
        existsSync(checkScript) &&
        !readFileSync(checkScript, { encoding: "utf-8" }).includes("swift_compile_checks.ts")
    ) {
        validation.error(
            "scripts/check_examples.ts must delegate compiler checks to swift_compile_checks.ts",
        );
    }
}

export function validatePackageHygiene(root: string, validation: Validation): void {
    for (const absolute of walkAll(root)) {
        const relative = path.relative(root, absolute);
        const extension = path.extname(absolute);
        if (
            relative.split(path.sep).includes("__pycache__") ||
            extension === ".pyc" ||
            extension === ".pyo" ||
            path.basename(absolute) === ".DS_Store"
        ) {
            validation.error(`generated artifact must not be packaged: ${relative}`);
        }
    }
}

export function validateNoPlaceholders(root: string, validation: Validation): void {
    // The tokens are assembled at runtime so this validator never trips over itself.
    const forbidden = new RegExp(
        `\\b(?:${["TO" + "DO", "T" + "BD", "FIX" + "ME"].join("|")})\\b`,
        "g",
    );
    for (const absolute of walkAll(root)) {
        if (!isFile(absolute) || !PROSE_SUFFIXES.includes(path.extname(absolute))) {
            continue;
        }
        const text = readFileSync(absolute, { encoding: "utf-8" });
        for (const match of text.matchAll(forbidden)) {
            const line = countLines(text, match.index);
            validation.error(
                `placeholder token ${match[0]} in ${path.relative(root, absolute)}:${line}`,
            );
        }
    }
}

export function runCommand(command: string[], cwd: string): [number, string] {
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined) {
        return [1, result.error.message];
    }
    const output = [result.stdout ?? "", result.stderr ?? ""]
        .map(part => part.trim())
        .filter(part => part !== "")
        .join("\n");
    return [result.status ?? 1, output];
}

export function validateExamples(root: string, validation: Validation, skipSwift: boolean): void {
    if (skipSwift) {
        validation.warn("Swift fixture checks were skipped by request");
        return;
    }
    const script = path.join(root, "scripts/check_examples.ts");
    if (!existsSync(script)) {
        return;
    }
    const [code, output] = runCommand([process.execPath, script], root);
    if (code !== 0) {
        validation.error(`Swift fixture checks failed:\n${output}`);
    } else if (output.startsWith("SKIP:")) {
        validation.warn(output);
    } else if (output !== "") {
        console.log(output);
    }
}

export function validateOfficialTool(root: string, validation: Validation): void {
    const executable = which("skills-ref");
    if (executable === null) {
        validation.warn("skills-ref is not installed; built-in validation was used");
        return;
    }
    const [code, output] = runCommand([executable, "validate", root], root);
    if (code !== 0) {
        validation.error(`skills-ref validation failed:\n${output}`);
    } else if (output !== "") {
        console.log(output);
    }
}

function which(program: string): string | null {
    for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
        if (entry === "") {
            continue;
        }
        const candidate = path.join(entry, program);
        try {
            accessSync(candidate, constants.X_OK);
            if (statSync(candidate).isFile()) {
                return candidate;
            }
        } catch {
            continue;
        }
    }
    return null;
}

function isFile(candidate: string): boolean {
    try {
        return statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function isDirectory(candidate: string): boolean {
    try {
        return statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

/** Every path under root, sorted, without following symlinked directories. */
function walkAll(root: string): string[] {
    const found: string[] = [];
    const visit = (directory: string): void => {
        let entries: Dirent[];
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            found.push(absolute);
            if (entry.isDirectory()) {
                visit(absolute);
            }
        }
    };
    visit(root);
    found.sort();
    return found;
}

function markdownFiles(root: string): string[] {
    return walkAll(root).filter(absolute => absolute.endsWith(".md") && isFile(absolute));
}

const USAGE = `usage: validate_skill.ts [-h] [--skip-swift] [--skip-official] [root]

${DESCRIPTION}

positional arguments:
  root             Skill directory; defaults to the parent of this script

options:
  -h, --help       show this help message and exit
  --skip-swift     Skip swiftc positive/negative fixture checks
  --skip-official  Do not invoke skills-ref when installed`;

export interface ValidateOptions {
    root: string | null;
    skipSwift: boolean;
    skipOfficial: boolean;
}

export function parseCommandLine(argv: string[]): ValidateOptions | "help" {
    const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            "skip-swift": { type: "boolean" },
            "skip-official": { type: "boolean" },
        },
    });
    if (parsed.values.help === true) {
        return "help";
    }
    if (parsed.positionals.length > 1) {
        throw new Error(`unrecognized arguments: ${parsed.positionals.slice(1).join(" ")}`);
    }
    return {
        root: parsed.positionals[0] ?? null,
        skipSwift: parsed.values["skip-swift"] === true,
        skipOfficial: parsed.values["skip-official"] === true,
    };
}

export function main(argv: string[] = process.argv.slice(2)): number {
    let options: ValidateOptions | "help";
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
    const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    let root = defaultRoot;
    if (options.root !== null) {
        const expanded =
            options.root === "~" || options.root.startsWith("~/")
                ? path.join(homedir(), options.root.slice(1))
                : options.root;
        const absolute = path.resolve(expanded);
        try {
            root = realpathSync(absolute);
        } catch {
            root = absolute;
        }
    }
    const validation = new Validation();

    if (!isDirectory(root)) {
        console.error(`error: not a directory: ${root}`);
        return 2;
    }

    validateRequiredPaths(root, validation);
    if (existsSync(path.join(root, "SKILL.md"))) {
        validateFrontmatter(root, validation);
    }
    validateMetadata(root, validation);
    validateLinks(root, validation);
    validateReferenceStructure(root, validation);
    validateTriggerEvals(root, validation);
    validateQualityEvals(root, validation);
    validateCompileManifest(root, validation);
    validateScriptPermissions(root, validation);
    validateAuditScript(root, validation);
    validateCurrentSwiftPolicy(root, validation);
    validatePackageHygiene(root, validation);
    validateNoPlaceholders(root, validation);
    validateExamples(root, validation, options.skipSwift);
    if (!options.skipOfficial) {
        validateOfficialTool(root, validation);
    }

    for (const warning of validation.warnings) {
        console.log(`WARNING: ${warning}`);
    }
    for (const error of validation.errors) {
        console.error(`ERROR: ${error}`);
    }

    if (validation.errors.length > 0) {
        console.error(
            `FAIL: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`,
        );
        return 1;
    }
    console.log(`PASS: skill validation completed with ${validation.warnings.length} warning(s)`);
    return 0;
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = main();
}
