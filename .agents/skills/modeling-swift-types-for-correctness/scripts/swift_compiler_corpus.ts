#!/usr/bin/env bun
/** Run the maintained Swift type-system corpus and emit bounded evidence. */

import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { machine, release, tmpdir, type } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
    type CheckResult,
    type ProcessResult,
    errorMessage,
    evaluateNegative,
    evaluatePositive,
    expandUser,
    isRecord,
    runProcess,
    sha256,
    sortedJson,
    which,
} from "./swift_compile_checks.ts";

export const DESCRIPTION = "Run the maintained Swift type-system corpus and emit bounded evidence.";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_ROOT);
export const DEFAULT_MANIFEST = path.join(SKILL_ROOT, "examples", "compiler-corpus-map.json");
// The frontend prints a shorter version banner than the driver, so minor and patch
// components are both optional here.
const VERSION_PATTERN = /Swift version (\d+)(?:\.(\d+))?(?:\.(\d+))?/;
const DECLARED_COMPILER_CASES = 89;
const DECLARED_RUNTIME_CHECKS = 2;
const EXPECTED_OUTCOMES = [
    "compile_error",
    "compile_success",
    "compile_success_without_diagnostics",
    "compile_success_with_warning",
];

export class CorpusError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CorpusError";
    }
}

export interface CorpusSource {
    kind: string;
    path?: string;
    snippet?: string;
    probe?: string;
    source_sha256?: string;
}

/** The recorded Swift 6.4.1 Linux outcome, carried into the report unchanged. */
export interface SuppliedOutcome {
    accepted: boolean;
    [extra: string]: unknown;
}

export interface CorpusCase {
    suite: string;
    name: string;
    lane: "default" | "experimental";
    source: CorpusSource;
    compiler_arguments: string[];
    expected_outcome: string;
    diagnostic_markers: string[];
    supplied_6_4_1: SuppliedOutcome;
    positive_control: string;
}

export interface CorpusRuntimeCheck {
    name: string;
    source: string;
    expected_stdout: string;
}

export interface CorpusManifest {
    cases: CorpusCase[];
    runtime_checks: CorpusRuntimeCheck[];
}

export interface ResolvedInput {
    origin?: string;
    sha256: string;
}

export interface CorpusReport {
    schema_version: number;
    status: string;
    recorded_utc: string;
    toolchain: { path: string | null; version: string | null; parsed_version?: string | null };
    platform: Record<string, unknown>;
    phase: string;
    shared_arguments: string[];
    runtime_shared_arguments: string[];
    snapshot: Record<string, unknown>;
    counts: Record<string, number>;
    controls: CheckResult[];
    results: CheckResult[];
    runtime_results: CheckResult[];
    deviations: Record<string, unknown>[];
    limitations: string[];
}

export function readJson(jsonPath: string): [Record<string, unknown>, Buffer] {
    let contents: Buffer;
    let value: unknown;
    try {
        contents = readFileSync(jsonPath);
        value = JSON.parse(contents.toString("utf-8"));
    } catch (error) {
        throw new CorpusError(`cannot read ${jsonPath}: ${errorMessage(error)}`);
    }
    if (!isRecord(value)) {
        throw new CorpusError(`${jsonPath} must contain a JSON object`);
    }
    return [value, contents];
}

function stringList(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item === "")) {
        return null;
    }
    return value.filter((item): item is string => typeof item === "string");
}

/** Validate the corpus map and narrow it to the shape the runner indexes. */
export function validateManifest(manifest: Record<string, unknown>): CorpusManifest {
    if (manifest.schema_version !== 1) {
        throw new CorpusError("schema_version must be 1");
    }
    const cases = manifest.cases;
    const runtimes = manifest.runtime_checks;
    // The counts are pinned deliberately: a corpus that silently loses or gains a
    // case is no longer the imported corpus this skill's evidence refers to.
    if (!Array.isArray(cases) || cases.length !== DECLARED_COMPILER_CASES) {
        throw new CorpusError(
            `manifest must map exactly ${DECLARED_COMPILER_CASES} compiler cases`,
        );
    }
    if (!Array.isArray(runtimes) || runtimes.length !== DECLARED_RUNTIME_CHECKS) {
        throw new CorpusError("manifest must map exactly two runtime checks");
    }
    const identities = new Set<string>();
    for (const item of cases) {
        if (isRecord(item) && typeof item.suite === "string" && typeof item.name === "string") {
            identities.add(`${item.suite}:${item.name}`);
        }
    }
    if (identities.size !== DECLARED_COMPILER_CASES) {
        throw new CorpusError("compiler case identities must be complete and unique");
    }

    const validated: CorpusCase[] = [];
    for (const item of cases) {
        if (!isRecord(item)) {
            throw new CorpusError("compiler case identities must be complete and unique");
        }
        const name = typeof item.name === "string" ? item.name : String(item.name);
        if (item.lane !== "default" && item.lane !== "experimental") {
            throw new CorpusError(`invalid lane for ${name}`);
        }
        const compilerArguments = stringList(item.compiler_arguments);
        if (compilerArguments === null) {
            throw new CorpusError(`invalid compiler arguments for ${name}`);
        }
        if (item.lane === "experimental" && compilerArguments.length === 0) {
            throw new CorpusError(`experimental case has no feature flag: ${name}`);
        }
        const expected = item.expected_outcome;
        if (typeof expected !== "string" || !EXPECTED_OUTCOMES.includes(expected)) {
            throw new CorpusError(`invalid expected outcome for ${name}`);
        }
        const markers = stringList(item.diagnostic_markers);
        if (markers === null) {
            throw new CorpusError(`invalid diagnostic markers for ${name}`);
        }
        const control = item.positive_control;
        if (
            expected === "compile_error" &&
            (markers.length === 0 || typeof control !== "string" || control === "")
        ) {
            throw new CorpusError(`negative case lacks a marker or control: ${name}`);
        }
        if (!isRecord(item.source) || typeof item.source.kind !== "string") {
            throw new CorpusError(`invalid source kind for ${name}`);
        }
        const supplied = item.supplied_6_4_1;
        if (!isRecord(supplied) || typeof supplied.accepted !== "boolean") {
            throw new CorpusError(`invalid supplied Swift 6.4.1 outcome for ${name}`);
        }
        if (typeof item.suite !== "string" || typeof item.name !== "string") {
            throw new CorpusError("compiler case identities must be complete and unique");
        }
        validated.push({
            suite: item.suite,
            name: item.name,
            lane: item.lane,
            source: {
                kind: item.source.kind,
                path: typeof item.source.path === "string" ? item.source.path : undefined,
                snippet: typeof item.source.snippet === "string" ? item.source.snippet : undefined,
                probe: typeof item.source.probe === "string" ? item.source.probe : undefined,
                source_sha256:
                    typeof item.source.source_sha256 === "string"
                        ? item.source.source_sha256
                        : undefined,
            },
            compiler_arguments: compilerArguments,
            expected_outcome: expected,
            diagnostic_markers: markers,
            supplied_6_4_1: { ...supplied, accepted: supplied.accepted },
            positive_control: typeof control === "string" ? control : "",
        });
    }

    const validatedRuntimes: CorpusRuntimeCheck[] = [];
    for (const check of runtimes) {
        if (
            !isRecord(check) ||
            typeof check.name !== "string" ||
            typeof check.source !== "string" ||
            typeof check.expected_stdout !== "string"
        ) {
            throw new CorpusError(
                "each runtime check must declare name, source, and expected_stdout",
            );
        }
        validatedRuntimes.push({
            name: check.name,
            source: check.source,
            expected_stdout: check.expected_stdout,
        });
    }
    return { cases: validated, runtime_checks: validatedRuntimes };
}

function resolvePath(value: string): string {
    const absolute = path.resolve(expandUser(value));
    try {
        return realpathSync(absolute);
    } catch {
        return absolute;
    }
}

function capture(command: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(command[0], command.slice(1), { encoding: "utf-8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function resolveCompiler(explicit: string | null): string | null {
    if (explicit !== null && explicit !== "") {
        return resolvePath(explicit);
    }
    const configured = process.env.SWIFT_FRONTEND ?? "";
    if (configured !== "") {
        return resolvePath(configured);
    }
    if (process.platform === "darwin") {
        const found = capture(["xcrun", "--find", "swift-frontend"]);
        if (found.status === 0 && found.stdout.trim() !== "") {
            return found.stdout.trim();
        }
    }
    return which("swift-frontend") ?? which("swiftc");
}

export function platformArguments(): [string[], Record<string, unknown>] {
    if (process.platform !== "darwin") {
        return [[], { sdk: null }];
    }
    const product = capture(["sw_vers", "-productVersion"]);
    const build = capture(["sw_vers", "-buildVersion"]);
    const details: Record<string, unknown> = {
        macos_version: product.status === 0 ? product.stdout.trim() : null,
        macos_build: build.status === 0 ? build.stdout.trim() : null,
    };
    const sdkPath = capture(["xcrun", "--sdk", "macosx", "--show-sdk-path"]);
    if (sdkPath.status !== 0 || sdkPath.stdout.trim() === "") {
        return [[], { ...details, sdk: null, sdk_error: (sdkPath.stdout + sdkPath.stderr).trim() }];
    }
    const sdk = sdkPath.stdout.trim();
    return [["-sdk", sdk], { ...details, sdk }];
}

export function fixtureSources(
    corpusRoot: string,
    manifest: CorpusManifest,
): [Map<string, Buffer>, Record<string, ResolvedInput>] {
    const [frontier, frontierBytes] = readJson(
        path.join(corpusRoot, "frontier_probes", "manifest.json"),
    );
    const probes = new Map<string, Record<string, unknown>>();
    if (Array.isArray(frontier.probes)) {
        for (const probe of frontier.probes) {
            if (isRecord(probe) && typeof probe.name === "string") {
                probes.set(probe.name, probe);
            }
        }
    }
    const snapshots = new Map<string, Buffer>();
    const resolved: Record<string, ResolvedInput> = {};
    for (const item of manifest.cases) {
        const key = `${item.suite}:${item.name}`;
        const source = item.source;
        let contents: Buffer;
        let origin: string;
        if (source.kind === "file" || source.kind === "append") {
            if (source.path === undefined) {
                throw new CorpusError(`invalid source kind for ${key}`);
            }
            const base = readFileSync(path.join(corpusRoot, source.path));
            // An "append" case is the shared suite source plus one misuse line, so the
            // valid control and the rejected probe stay one edit apart.
            contents =
                source.kind === "append"
                    ? Buffer.concat([base, Buffer.from(`\n${source.snippet ?? ""}\n`, "utf-8")])
                    : base;
            origin = source.path;
        } else if (source.kind === "frontier") {
            const probe = source.probe === undefined ? undefined : probes.get(source.probe);
            if (probe === undefined || typeof probe.source !== "string") {
                throw new CorpusError(`missing frontier probe: ${source.probe}`);
            }
            contents = Buffer.from(probe.source, "utf-8");
            if (sha256(contents) !== source.source_sha256) {
                throw new CorpusError(`frontier source hash mismatch: ${source.probe}`);
            }
            origin = "frontier_probes/manifest.json#" + source.probe;
        } else {
            throw new CorpusError(`invalid source kind for ${key}`);
        }
        snapshots.set(key, contents);
        resolved[key] = { origin, sha256: sha256(contents) };
    }
    for (const check of manifest.runtime_checks) {
        const key = "runtime:" + check.name;
        const contents = readFileSync(path.join(corpusRoot, check.source));
        snapshots.set(key, contents);
        resolved[key] = { origin: check.source, sha256: sha256(contents) };
    }
    resolved.frontier_manifest = { sha256: sha256(frontierBytes) };
    return [snapshots, resolved];
}

export function compilerCommand(
    compiler: string,
    sdkArguments: string[],
    sharedArguments: string[],
    caseArguments: string[],
    source: string,
    output: string,
    moduleCache: string,
    moduleName: string,
): string[] {
    return [
        compiler,
        "-emit-sil",
        "-swift-version",
        "6",
        ...sdkArguments,
        "-module-cache-path",
        moduleCache,
        "-module-name",
        moduleName,
        ...sharedArguments,
        ...caseArguments,
        source,
        "-o",
        output,
    ];
}

/** Runtime checks need the driver, not the frontend, to link an executable. */
export function runtimeCompiler(compiler: string): string {
    const sibling = path.join(path.dirname(compiler), "swiftc");
    return existsSync(sibling) ? sibling : compiler;
}

export function evaluateCase(
    item: CorpusCase,
    outcome: ProcessResult,
    compatibleDiagnosticSets: Record<string, string[][]>,
): CheckResult {
    const expected = item.expected_outcome;
    let result: CheckResult;
    if (expected === "compile_error") {
        result = evaluateNegative(
            { name: item.name, diagnostic_markers: item.diagnostic_markers },
            outcome,
        );
        let diagnosticSource = "supplied-6.4.1";
        const key = `${item.suite}:${item.name}`;
        if (result.status !== "pass") {
            // A newer toolchain may word the same rejection differently. Each recorded
            // alternative is still fail-closed, so accepting one never weakens the check.
            for (const markers of compatibleDiagnosticSets[key] ?? []) {
                const candidate = evaluateNegative(
                    { name: item.name, diagnostic_markers: markers },
                    outcome,
                );
                if (candidate.status === "pass") {
                    result = candidate;
                    diagnosticSource = "compatible-toolchain";
                    break;
                }
            }
        }
        result.diagnostic_evidence = diagnosticSource;
    } else {
        result = evaluatePositive(item.name, outcome);
        const output = outcome.output;
        if (
            result.status === "pass" &&
            expected === "compile_success_without_diagnostics" &&
            output.trim() !== ""
        ) {
            result.status = "fail";
            result.reason = "compiled with unexpected diagnostics";
        }
        if (result.status === "pass" && expected === "compile_success_with_warning") {
            const markers = item.diagnostic_markers;
            if (!output.includes("warning:") || markers.some(marker => !output.includes(marker))) {
                result.status = "fail";
                result.reason = "expected warning was not observed";
            }
        }
    }
    result.suite = item.suite;
    result.lane = item.lane;
    result.expected_outcome = expected;
    result.expected_diagnostic_markers = item.diagnostic_markers;
    result.supplied_6_4_1 = item.supplied_6_4_1;
    result.observed_accepted = outcome.returncode === 0;
    result.deviates_from_supplied_6_4_1 =
        outcome.returncode !== null && result.observed_accepted !== item.supplied_6_4_1.accepted;
    return result;
}

export function run(
    manifestPath: string,
    compiler: string | null,
    timeout: number,
    compileTarget: string | null = null,
): CorpusReport {
    const [rawManifest, manifestBytes] = readJson(manifestPath);
    const manifest = validateManifest(rawManifest);
    const corpusRoot = path.join(path.dirname(manifestPath), "compiler-corpus");
    const [snapshots, resolved] = fixtureSources(corpusRoot, manifest);
    const [controlsManifest, controlsBytes] = readJson(
        path.join(path.dirname(manifestPath), "compiler-corpus-controls.json"),
    );
    const [compatibilityManifest, compatibilityBytes] = readJson(
        path.join(path.dirname(manifestPath), "compiler-corpus-diagnostic-compatibility.json"),
    );
    const controlPairs = controlsManifest.pairs;
    const negativeKeys = manifest.cases
        .filter(item => item.expected_outcome === "compile_error")
        .map(item => `${item.suite}:${item.name}`);
    if (!isRecord(controlPairs) || !sameKeySet(Object.keys(controlPairs), negativeKeys)) {
        throw new CorpusError("control-pair map must cover every negative case exactly once");
    }
    const pairs = new Map<string, string>();
    for (const [key, value] of Object.entries(controlPairs)) {
        if (typeof value !== "string" || !snapshots.has(value)) {
            throw new CorpusError("control-pair map names an unknown compiler case");
        }
        pairs.set(key, value);
    }
    const [sdkArguments, platformDetails] = platformArguments();
    const sharedArguments = compileTarget !== null ? ["-target", compileTarget] : [];
    const runtimeSharedArguments = ["-emit-executable", "-swift-version", "6", ...sdkArguments];
    const limitations = [
        "Compiler results apply only to the recorded source hashes, toolchain, platform, phase, and arguments.",
        "Supplied Swift 6.4.1 Linux outcomes are preserved separately; current observations never rewrite them.",
        "Performance experiments are outside this corpus. Effects and frontier probes are compiled only.",
    ];
    if (compileTarget !== null) {
        limitations.push(
            `Compile-only probes target ${compileTarget}; runtime builds omit that target and use the ` +
                "compiler's host-compatible default because their binaries execute on this host.",
        );
    }
    const report: CorpusReport = {
        schema_version: 1,
        status: "fail",
        // ISO-8601 with an explicit +00:00 offset rather than the Z shorthand.
        recorded_utc: new Date().toISOString().replace("Z", "+00:00"),
        toolchain: { path: compiler, version: null },
        platform: { system: type(), release: release(), machine: machine(), ...platformDetails },
        phase: "emit-sil ownership checking",
        shared_arguments: ["-emit-sil", "-swift-version", "6", ...sdkArguments, ...sharedArguments],
        runtime_shared_arguments: runtimeSharedArguments,
        snapshot: {
            manifest: path.resolve(manifestPath),
            sha256: sha256(manifestBytes),
            controls_sha256: sha256(controlsBytes),
            inputs: resolved,
            diagnostic_compatibility_sha256: sha256(compatibilityBytes),
        },
        counts: {
            declared_compiler_cases: DECLARED_COMPILER_CASES,
            declared_runtime_checks: DECLARED_RUNTIME_CHECKS,
        },
        controls: [],
        results: [],
        runtime_results: [],
        deviations: [],
        limitations,
    };
    if (compiler === null || !existsSync(compiler)) {
        report.status = "unavailable";
        report.limitations.unshift("swift-frontend was unavailable; no compiler case was checked.");
        return report;
    }
    const version = runProcess(
        [compiler, "-version"],
        path.dirname(manifestPath),
        Math.max(timeout, 5),
    );
    if (version.outcome !== "completed" || version.returncode !== 0) {
        report.status = "unavailable";
        report.limitations.unshift(
            "the compiler version was unavailable; no compiler case was checked.",
        );
        return report;
    }
    report.toolchain.version = version.output.trim();
    const match = VERSION_PATTERN.exec(version.output);
    report.toolchain.parsed_version =
        match === null ? null : [match[1], match[2], match[3]].map(part => part ?? "0").join(".");
    let compatibleDiagnosticSets: Record<string, string[][]> = {};
    const toolchains = compatibilityManifest.toolchains;
    if (Array.isArray(toolchains)) {
        for (const item of toolchains) {
            if (
                isRecord(item) &&
                typeof item.version_contains === "string" &&
                version.output.includes(item.version_contains)
            ) {
                compatibleDiagnosticSets = diagnosticSets(item.diagnostic_sets);
                break;
            }
        }
    }

    const temporary = mkdtempSync(path.join(tmpdir(), "swift-compiler-corpus-"));
    try {
        const moduleCache = path.join(temporary, "module-cache");
        mkdirSync(moduleCache);
        const controls = new Map<string, CheckResult>();
        for (const item of manifest.cases) {
            if (item.expected_outcome !== "compile_error") {
                continue;
            }
            const caseKey = `${item.suite}:${item.name}`;
            const controlKey = pairs.get(caseKey) ?? "";
            const flags = item.compiler_arguments;
            // One control per (source, flag set): the experimental lanes change what the
            // valid control itself must prove, so they cannot share a cached result.
            const cacheKey = JSON.stringify([controlKey, flags]);
            if (controls.has(cacheKey)) {
                continue;
            }
            const ordinal = String(controls.size);
            const controlSource = path.join(temporary, `control-${ordinal}.swift`);
            const snapshot = snapshots.get(controlKey);
            if (snapshot === undefined) {
                throw new CorpusError("control-pair map names an unknown compiler case");
            }
            writeFileSync(controlSource, snapshot);
            const command = compilerCommand(
                compiler,
                sdkArguments,
                sharedArguments,
                [...flags],
                controlSource,
                path.join(temporary, `control-${ordinal}.sil`),
                moduleCache,
                "CorpusControl" + ordinal,
            );
            const outcome = runProcess(command, corpusRoot, timeout);
            const control = evaluatePositive(controlKey, outcome);
            control.lane = item.lane;
            control.compiler_arguments = [...flags];
            control.input_sha256 = resolved[controlKey].sha256;
            controls.set(cacheKey, control);
            report.controls.push(control);
        }

        manifest.cases.forEach((item, index) => {
            const key = `${item.suite}:${item.name}`;
            const source = path.join(temporary, `case-${index}.swift`);
            const snapshot = snapshots.get(key);
            if (snapshot === undefined) {
                throw new CorpusError(`missing snapshot for ${key}`);
            }
            writeFileSync(source, snapshot);
            const flags = item.compiler_arguments;
            const controlKey = pairs.get(key);
            const paired =
                controlKey === undefined
                    ? undefined
                    : controls.get(JSON.stringify([controlKey, flags]));
            let result: CheckResult;
            if (paired !== undefined && paired.status !== "pass") {
                result = {
                    name: item.name,
                    suite: item.suite,
                    lane: item.lane,
                    kind: "negative",
                    status: "fail",
                    reason: `paired positive control ${controlKey} is broken`,
                    returncode: null,
                    command: [],
                    diagnostics: "",
                    expected_outcome: item.expected_outcome,
                    expected_diagnostic_markers: item.diagnostic_markers,
                    supplied_6_4_1: item.supplied_6_4_1,
                    observed_accepted: null,
                    deviates_from_supplied_6_4_1: false,
                };
            } else {
                const command = compilerCommand(
                    compiler,
                    sdkArguments,
                    sharedArguments,
                    [...flags],
                    source,
                    path.join(temporary, `case-${index}.sil`),
                    moduleCache,
                    "CorpusCase" + String(index),
                );
                const outcome = runProcess(command, corpusRoot, timeout);
                result = evaluateCase(item, outcome, compatibleDiagnosticSets);
            }
            result.input_sha256 = resolved[key].sha256;
            result.positive_control = controlKey ?? null;
            report.results.push(result);
            if (result.deviates_from_supplied_6_4_1 === true) {
                report.deviations.push({
                    suite: item.suite,
                    name: item.name,
                    supplied_accepted: item.supplied_6_4_1.accepted,
                    observed_accepted: result.observed_accepted,
                    reason: result.reason,
                    diagnostics: result.diagnostics,
                });
            }
        });

        manifest.runtime_checks.forEach((check, index) => {
            const key = "runtime:" + check.name;
            const source = path.join(temporary, `runtime-${index}.swift`);
            const snapshot = snapshots.get(key);
            if (snapshot === undefined) {
                throw new CorpusError(`missing snapshot for ${key}`);
            }
            writeFileSync(source, snapshot);
            const executable = path.join(temporary, `runtime-${index}`);
            const command = [
                runtimeCompiler(compiler),
                ...runtimeSharedArguments,
                "-module-cache-path",
                moduleCache,
                source,
                "-o",
                executable,
            ];
            const build = runProcess(command, corpusRoot, timeout);
            const buildResult = evaluatePositive(check.name, build);
            buildResult.kind = "runtime-build";
            buildResult.input_sha256 = resolved[key].sha256;
            report.runtime_results.push(buildResult);
            if (buildResult.status === "pass") {
                const execution = runProcess([executable], corpusRoot, timeout);
                const outputMatches = execution.output.trim() === check.expected_stdout;
                const status =
                    execution.outcome === "completed" && execution.returncode === 0 && outputMatches
                        ? "pass"
                        : "fail";
                report.runtime_results.push({
                    name: check.name,
                    kind: "runtime",
                    status,
                    reason:
                        status === "pass"
                            ? "completed with expected output"
                            : "runtime check failed",
                    returncode: execution.returncode,
                    command: execution.command,
                    diagnostics: execution.output,
                    expected_stdout: check.expected_stdout,
                    input_sha256: resolved[key].sha256,
                });
            }
        });
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }

    report.counts.recorded_compiler_cases = report.results.length;
    report.counts.invoked_compiler_cases = report.results.filter(
        item => item.command.length > 0,
    ).length;
    report.counts.blocked_compiler_cases = report.results.filter(
        item => item.command.length === 0,
    ).length;
    report.counts.executed_runtime_checks = report.runtime_results.filter(
        item => item.kind === "runtime",
    ).length;
    report.counts.passed_compiler_cases = report.results.filter(
        item => item.status === "pass",
    ).length;
    report.counts.failed_compiler_cases = report.results.filter(
        item => item.status !== "pass",
    ).length;
    const allResults = [...report.controls, ...report.results, ...report.runtime_results];
    report.status = allResults.every(item => item.status === "pass") ? "pass" : "fail";
    return report;
}

function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
    const expected = new Set(right);
    return left.length === expected.size && left.every(key => expected.has(key));
}

function diagnosticSets(value: unknown): Record<string, string[][]> {
    const sets: Record<string, string[][]> = {};
    if (!isRecord(value)) {
        return sets;
    }
    for (const [key, alternatives] of Object.entries(value)) {
        if (!Array.isArray(alternatives)) {
            continue;
        }
        const parsed: string[][] = [];
        for (const alternative of alternatives) {
            const markers = stringList(alternative);
            if (markers !== null) {
                parsed.push(markers);
            }
        }
        sets[key] = parsed;
    }
    return sets;
}

const USAGE = `usage: swift_compiler_corpus.ts [-h] [--swiftc SWIFTC] [--timeout TIMEOUT]
                                [--compile-target COMPILE_TARGET] [--json]
                                [--report REPORT]
                                [manifest]

${DESCRIPTION}

positional arguments:
  manifest

options:
  -h, --help            show this help message and exit
  --swiftc SWIFTC
  --timeout TIMEOUT
  --compile-target COMPILE_TARGET
                        target triple for compile-only controls and cases; never
                        applied to runtime builds
  --json
  --report REPORT`;

export interface CorpusOptions {
    manifest: string;
    swiftc: string | null;
    timeout: number;
    compileTarget: string | null;
    json: boolean;
    report: string | null;
}

export function parseCommandLine(argv: string[]): CorpusOptions | "help" {
    const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            swiftc: { type: "string" },
            timeout: { type: "string" },
            "compile-target": { type: "string" },
            json: { type: "boolean" },
            report: { type: "string" },
        },
    });
    if (parsed.values.help === true) {
        return "help";
    }
    if (parsed.positionals.length > 1) {
        throw new CorpusError(`unrecognized arguments: ${parsed.positionals.slice(1).join(" ")}`);
    }
    const timeout = parsed.values.timeout === undefined ? 45 : Number(parsed.values.timeout);
    if (!Number.isFinite(timeout)) {
        throw new CorpusError("--timeout must be a number");
    }
    return {
        manifest: parsed.positionals[0] ?? DEFAULT_MANIFEST,
        swiftc: parsed.values.swiftc ?? null,
        timeout,
        compileTarget: parsed.values["compile-target"] ?? null,
        json: parsed.values.json === true,
        report: parsed.values.report ?? null,
    };
}

export function main(argv: string[] = process.argv.slice(2)): number {
    let options: CorpusOptions | "help";
    try {
        options = parseCommandLine(argv);
    } catch (error) {
        console.error(USAGE);
        console.error(`error: ${errorMessage(error)}`);
        return 2;
    }
    if (options === "help") {
        console.log(USAGE);
        return 0;
    }
    let report: CorpusReport;
    try {
        report = run(
            path.resolve(expandUser(options.manifest)),
            resolveCompiler(options.swiftc),
            options.timeout,
            options.compileTarget,
        );
    } catch (error) {
        console.error(`error: ${errorMessage(error)}`);
        return 1;
    }
    const rendered = sortedJson(report) + "\n";
    if (options.report !== null) {
        const reportPath = path.resolve(expandUser(options.report));
        mkdirSync(path.dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, rendered, { encoding: "utf-8" });
    }
    if (options.json) {
        process.stdout.write(rendered);
    } else {
        console.log(
            `${report.status.toUpperCase()}: ${report.counts.invoked_compiler_cases ?? 0}/${DECLARED_COMPILER_CASES} ` +
                "compiler cases invoked",
        );
        const version = report.toolchain.version;
        console.log(
            `Toolchain: ${(version === null || version === "" ? "unavailable" : version).split(/\r\n|\r|\n/)[0]}`,
        );
        const defaultLane = report.results.filter(item => item.lane === "default").length;
        const experimentalLane = report.results.filter(item => item.lane === "experimental").length;
        console.log(`Default/experimental lanes: ${defaultLane}/${experimentalLane}`);
        console.log(`Supplied-v-observed deviations: ${report.deviations.length}`);
        for (const item of report.results) {
            if (item.status !== "pass") {
                console.error(`FAIL ${String(item.suite)}:${item.name} — ${item.reason}`);
            }
        }
    }
    if (report.status === "pass") {
        return 0;
    }
    return report.status === "unavailable" ? 2 : 1;
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = main();
}
