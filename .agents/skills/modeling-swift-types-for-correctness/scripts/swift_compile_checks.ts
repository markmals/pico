#!/usr/bin/env bun
/** Run manifest-defined Swift positive controls and negative compile checks. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    accessSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readFileSync,
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
    "Run manifest-defined Swift positive controls and negative compile checks.";

const VERSION_PATTERN = /Swift version (\d+)\.(\d+)(?:\.(\d+))?/;
const DIAGNOSTIC_PATTERN = /^(?:(?:.+?):\d+(?::\d+)?: )?error: (.+)$/;
const DRIVER_SUMMARY_PATTERN =
    /^emit-module command failed with exit code \d+ \(use -v to see invocation\)$/;
const CRASH_MARKERS = [
    "Stack dump:",
    "PLEASE submit a bug report",
    "Segmentation fault",
    "Assertion failed",
    "fatal error encountered during compilation",
];
// Diagnostics are split on CR, LF, and CRLF so a toolchain that emits classic Mac or
// Windows line endings still parses.
const LINE_BREAK = /\r\n|\r|\n/;
// The compiler can emit large diagnostic volumes. Keep the captured output far above
// anything a fixture produces so a check never fails as a buffering artifact.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class ManifestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManifestError";
    }
}

export interface CompileItem {
    name: string;
    sources: string[];
}

export interface NegativeFixture extends CompileItem {
    positive_control: string;
    diagnostic_markers: string[];
}

export interface RuntimeCheck extends CompileItem {
    compiler_arguments: string[];
}

export interface Manifest {
    schema_version: number;
    minimum_swift_version: string;
    compiler_arguments: string[];
    support_sources: string[];
    positive_controls: CompileItem[];
    negative_fixtures: NegativeFixture[];
    runtime_checks: RuntimeCheck[];
}

export interface ResolvedInputs {
    compiler_arguments: string[];
    support_sources: string[];
    positive_controls: CompileItem[];
    negative_fixtures: NegativeFixture[];
    runtime_checks: RuntimeCheck[];
}

export type ProcessOutcome = "completed" | "crash" | "timeout" | "unavailable";

export interface ProcessResult {
    outcome: ProcessOutcome;
    returncode: number | null;
    output: string;
    command: string[];
    input_changes?: string[];
}

export interface CheckResult {
    name: string;
    kind: string;
    status: string;
    reason: string;
    returncode: number | null;
    command: string[];
    diagnostics: string;
    [extra: string]: unknown;
}

export interface CompileReport {
    schema_version: number;
    status: string;
    phase: string;
    toolchain: { path: string | null; version: string | null; parsed_version: string | null };
    snapshot: { manifest: string; sha256: string | null; sources?: Record<string, string> };
    inputs: ResolvedInputs | null;
    results: CheckResult[];
    limitations: string[];
}

/** Canonical object guard for this script pair; fields stay `unknown` until checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function sha256(contents: Buffer): string {
    return createHash("sha256").update(contents).digest("hex");
}

/** Mirror `json.dumps(value, indent=2, sort_keys=True)` so reports stay byte-stable. */
export function sortedJson(value: unknown, indentation = ""): string {
    const inner = indentation + "  ";
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        const items = value.map((item: unknown) => inner + sortedJson(item, inner));
        return `[\n${items.join(",\n")}\n${indentation}]`;
    }
    if (isRecord(value)) {
        const keys = Object.keys(value).sort();
        if (keys.length === 0) {
            return "{}";
        }
        const items = keys.map(
            key => `${inner}${JSON.stringify(key)}: ${sortedJson(value[key], inner)}`,
        );
        return `{\n${items.join(",\n")}\n${indentation}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function strings(value: unknown, label: string, options: { nonempty?: boolean } = {}): string[] {
    if (!Array.isArray(value)) {
        throw new ManifestError(`${label} must be an array of nonempty strings`);
    }
    const items: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || item.trim() === "") {
            throw new ManifestError(`${label} must be an array of nonempty strings`);
        }
        items.push(item);
    }
    if (options.nonempty === true && items.length === 0) {
        throw new ManifestError(`${label} must not be empty`);
    }
    return items;
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: readonly string[],
    label: string,
): void {
    const unknown = Object.keys(value)
        .filter(key => !allowed.includes(key))
        .sort();
    if (unknown.length > 0) {
        throw new ManifestError(`${label} has unknown field(s): ${unknown.join(", ")}`);
    }
}

export function validateCompilerArguments(compilerArguments: readonly string[]): void {
    if (!compilerArguments.includes("-emit-module")) {
        throw new ManifestError("compiler_arguments must include -emit-module");
    }
    if (compilerArguments.includes("-typecheck")) {
        throw new ManifestError(
            "compiler_arguments must not include -typecheck with the emit-module phase",
        );
    }
    const swiftVersionIndexes: number[] = [];
    compilerArguments.forEach((value, index) => {
        if (value === "-swift-version") {
            swiftVersionIndexes.push(index);
        }
    });
    if (swiftVersionIndexes.length !== 1) {
        throw new ManifestError(
            "compiler_arguments must contain exactly one -swift-version option",
        );
    }
    const index = swiftVersionIndexes[0];
    if (index + 1 >= compilerArguments.length || compilerArguments[index + 1] !== "6") {
        throw new ManifestError("compiler_arguments must select Swift 6 language mode");
    }
}

/** Pad a dotted version to the three components the manifest comparison rule uses. */
export function paddedVersion(value: string): [number, number, number] {
    const parts = value.split(".").map(part => Number.parseInt(part, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareVersions(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const leftPart = left[index] ?? 0;
        const rightPart = right[index] ?? 0;
        if (leftPart !== rightPart) {
            return leftPart < rightPart ? -1 : 1;
        }
    }
    return 0;
}

export function parseSwiftVersion(output: string): [number, number, number] | null {
    const match = VERSION_PATTERN.exec(output);
    if (match === null) {
        return null;
    }
    return [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        match[3] === undefined ? 0 : Number.parseInt(match[3], 10),
    ];
}

export function parseManifest(contents: Buffer | string): Manifest {
    let data: unknown;
    try {
        data = JSON.parse(typeof contents === "string" ? contents : contents.toString("utf-8"));
    } catch (error) {
        throw new ManifestError(`cannot read manifest: ${errorMessage(error)}`);
    }
    if (!isRecord(data)) {
        throw new ManifestError("manifest root must be an object");
    }
    rejectUnknownFields(
        data,
        [
            "schema_version",
            "minimum_swift_version",
            "compiler_arguments",
            "support_sources",
            "positive_controls",
            "negative_fixtures",
            "runtime_checks",
        ],
        "manifest",
    );
    const schemaVersion = data.schema_version;
    if (
        typeof schemaVersion !== "number" ||
        !Number.isInteger(schemaVersion) ||
        schemaVersion !== 1
    ) {
        throw new ManifestError("schema_version must be 1");
    }
    const minimum = data.minimum_swift_version;
    if (typeof minimum !== "string" || !/^\d+\.\d+(?:\.\d+)?$/.test(minimum)) {
        throw new ManifestError("minimum_swift_version must be a dotted version string");
    }
    if (compareVersions(paddedVersion(minimum), [6, 3, 0]) < 0) {
        throw new ManifestError("minimum_swift_version must be 6.3 or newer");
    }
    const compilerArguments = strings(data.compiler_arguments, "compiler_arguments", {
        nonempty: true,
    });
    validateCompilerArguments(compilerArguments);
    const supportSources = strings(data.support_sources, "support_sources", { nonempty: true });

    const controls = data.positive_controls;
    const negatives = data.negative_fixtures;
    if (!Array.isArray(controls) || controls.length === 0) {
        throw new ManifestError("positive_controls must be a nonempty array");
    }
    if (!Array.isArray(negatives) || negatives.length === 0) {
        throw new ManifestError("negative_fixtures must be a nonempty array");
    }

    const controlNames = new Set<string>();
    const positiveControls: CompileItem[] = [];
    controls.forEach((control: unknown, index: number) => {
        const label = `positive_controls[${index}]`;
        if (!isRecord(control)) {
            throw new ManifestError(`${label} must be an object`);
        }
        rejectUnknownFields(control, ["name", "sources"], label);
        const name = control.name;
        if (typeof name !== "string" || name.trim() === "" || controlNames.has(name)) {
            throw new ManifestError(`${label}.name must be unique and nonempty`);
        }
        controlNames.add(name);
        positiveControls.push({
            name,
            sources: strings(control.sources, `${label}.sources`, { nonempty: true }),
        });
    });

    const fixtureNames = new Set<string>();
    const negativeFixtures: NegativeFixture[] = [];
    negatives.forEach((fixture: unknown, index: number) => {
        const label = `negative_fixtures[${index}]`;
        if (!isRecord(fixture)) {
            throw new ManifestError(`${label} must be an object`);
        }
        rejectUnknownFields(
            fixture,
            ["name", "sources", "positive_control", "diagnostic_markers"],
            label,
        );
        const name = fixture.name;
        if (typeof name !== "string" || name.trim() === "" || fixtureNames.has(name)) {
            throw new ManifestError(`${label}.name must be unique and nonempty`);
        }
        fixtureNames.add(name);
        const sources = strings(fixture.sources, `${label}.sources`, { nonempty: true });
        const markers = strings(fixture.diagnostic_markers, `${label}.diagnostic_markers`, {
            nonempty: true,
        });
        const paired = fixture.positive_control;
        if (typeof paired !== "string" || !controlNames.has(paired)) {
            throw new ManifestError(
                `${label}.positive_control must name a declared positive control`,
            );
        }
        negativeFixtures.push({
            name,
            sources,
            positive_control: paired,
            diagnostic_markers: markers,
        });
    });

    // An absent key defaults to empty; an explicit null is still a manifest error.
    const declaredRuntimeChecks = data.runtime_checks === undefined ? [] : data.runtime_checks;
    if (!Array.isArray(declaredRuntimeChecks)) {
        throw new ManifestError("runtime_checks must be an array");
    }
    const runtimeChecks: RuntimeCheck[] = [];
    declaredRuntimeChecks.forEach((check: unknown, index: number) => {
        const label = `runtime_checks[${index}]`;
        if (!isRecord(check) || typeof check.name !== "string" || check.name.trim() === "") {
            throw new ManifestError(`${label} must be an object with a name`);
        }
        rejectUnknownFields(check, ["name", "sources", "compiler_arguments"], label);
        runtimeChecks.push({
            name: check.name,
            sources: strings(check.sources, `${label}.sources`, { nonempty: true }),
            compiler_arguments: strings(
                check.compiler_arguments === undefined ? [] : check.compiler_arguments,
                `${label}.compiler_arguments`,
            ),
        });
    });

    return {
        schema_version: schemaVersion,
        minimum_swift_version: minimum,
        compiler_arguments: compilerArguments,
        support_sources: supportSources,
        positive_controls: positiveControls,
        negative_fixtures: negativeFixtures,
        runtime_checks: runtimeChecks,
    };
}

export function loadManifest(manifestPath: string): Manifest {
    let contents: Buffer;
    try {
        contents = readFileSync(manifestPath);
    } catch (error) {
        throw new ManifestError(`cannot read manifest: ${errorMessage(error)}`);
    }
    return parseManifest(contents);
}

function declaredSources(manifest: Manifest): Set<string> {
    const names = new Set<string>(manifest.support_sources);
    for (const item of [
        ...manifest.positive_controls,
        ...manifest.negative_fixtures,
        ...manifest.runtime_checks,
    ]) {
        for (const source of item.sources) {
            names.add(source);
        }
    }
    return names;
}

export function resolveInputs(manifestPath: string, manifest: Manifest): ResolvedInputs {
    const root = path.dirname(manifestPath);
    const missing = [...declaredSources(manifest)]
        .sort()
        .filter(relative => !isFile(path.join(root, relative)));
    if (missing.length > 0) {
        throw new ManifestError(`missing source file(s): ${missing.join(", ")}`);
    }
    return {
        compiler_arguments: manifest.compiler_arguments,
        support_sources: manifest.support_sources,
        positive_controls: manifest.positive_controls,
        negative_fixtures: manifest.negative_fixtures,
        runtime_checks: manifest.runtime_checks,
    };
}

function isFile(candidate: string): boolean {
    try {
        return statSync(candidate).isFile();
    } catch {
        return false;
    }
}

export function sourceSnapshots(manifestPath: string, manifest: Manifest): Map<string, Buffer> {
    const snapshots = new Map<string, Buffer>();
    for (const source of [...declaredSources(manifest)].sort()) {
        const sourcePath = path.join(path.dirname(manifestPath), source);
        try {
            snapshots.set(source, readFileSync(sourcePath));
        } catch (error) {
            throw new ManifestError(
                `cannot snapshot source file ${source}: ${errorMessage(error)}`,
            );
        }
    }
    return snapshots;
}

export function stageSources(
    directory: string,
    snapshots: Map<string, Buffer>,
): Map<string, string> {
    const staged = new Map<string, string>();
    let index = 0;
    for (const [source, contents] of snapshots) {
        // Each source gets its own numbered directory so same-named fixtures from
        // different manifest entries never collide inside the staging tree.
        const destination = path.join(directory, String(index), path.basename(source));
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, contents);
        staged.set(source, destination);
        index += 1;
    }
    return staged;
}

export function changedStagedSources(
    staged: Map<string, string>,
    snapshots: Map<string, Buffer>,
): string[] {
    const changed: string[] = [];
    for (const [source, stagedPath] of staged) {
        let contents: Buffer;
        try {
            contents = readFileSync(stagedPath);
        } catch {
            changed.push(source);
            continue;
        }
        const snapshot = snapshots.get(source);
        if (snapshot === undefined || !contents.equals(snapshot)) {
            changed.push(source);
        }
    }
    return changed;
}

export function moduleName(name: string): string {
    return "Fixture_" + name.replace(/[^A-Za-z0-9_]/g, "_");
}

export function runProcess(command: string[], cwd: string, timeout: number): ProcessResult {
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        encoding: "utf-8",
        timeout: Math.ceil(timeout * 1000),
        maxBuffer: MAX_OUTPUT_BYTES,
    });
    const output = [result.stdout, result.stderr]
        .filter(part => typeof part === "string" && part !== "")
        .join("\n");
    if (result.error !== undefined) {
        const code = isRecord(result.error) ? result.error.code : undefined;
        if (code === "ETIMEDOUT") {
            return { outcome: "timeout", returncode: null, output, command };
        }
        return {
            outcome: "unavailable",
            returncode: null,
            output: errorMessage(result.error),
            command,
        };
    }
    // A signal-terminated compiler reports no exit status; treat that as a crash,
    // exactly like the textual crash markers a surviving frontend prints.
    const lowered = output.toLowerCase();
    const crashed =
        result.signal !== null ||
        CRASH_MARKERS.some(marker => lowered.includes(marker.toLowerCase()));
    return { outcome: crashed ? "crash" : "completed", returncode: result.status, output, command };
}

function sourcePaths(staged: Map<string, string>, support: string[], sources: string[]): string[] {
    return [...support, ...sources].map(source => {
        const stagedPath = staged.get(source);
        if (stagedPath === undefined) {
            throw new ManifestError(`source was not staged: ${source}`);
        }
        return stagedPath;
    });
}

export function compileCommand(
    swiftc: string,
    staged: Map<string, string>,
    temporary: string,
    compilerArguments: string[],
    support: string[],
    item: CompileItem,
): string[] {
    const module = moduleName(item.name);
    return [
        swiftc,
        ...compilerArguments,
        "-module-name",
        module,
        "-emit-module-path",
        path.join(temporary, `${module}.swiftmodule`),
        ...sourcePaths(staged, support, item.sources),
    ];
}

function makeResult(
    name: string,
    kind: string,
    outcome: ProcessResult,
    status: string,
    reason: string,
): CheckResult {
    return {
        name,
        kind,
        status,
        reason,
        returncode: outcome.returncode,
        command: outcome.command,
        diagnostics: outcome.output,
    };
}

export function evaluatePositive(name: string, outcome: ProcessResult): CheckResult {
    if (outcome.outcome === "timeout") {
        return makeResult(name, "positive", outcome, "fail", "compiler timed out");
    }
    if (outcome.outcome === "crash") {
        return makeResult(name, "positive", outcome, "fail", "compiler crashed");
    }
    if (outcome.outcome === "unavailable") {
        return makeResult(name, "positive", outcome, "fail", "compiler became unavailable");
    }
    if (outcome.input_changes !== undefined && outcome.input_changes.length > 0) {
        const changed = outcome.input_changes.join(", ");
        return makeResult(
            name,
            "positive",
            outcome,
            "fail",
            `staged source changed during compilation: ${changed}`,
        );
    }
    if (outcome.returncode !== 0) {
        return makeResult(name, "positive", outcome, "fail", "positive control did not compile");
    }
    return makeResult(name, "positive", outcome, "pass", "compiled");
}

export function evaluateNegative(
    item: { name: string; diagnostic_markers: string[] },
    outcome: ProcessResult,
): CheckResult {
    const name = item.name;
    if (outcome.outcome === "timeout") {
        return makeResult(name, "negative", outcome, "fail", "compiler timed out");
    }
    if (outcome.outcome === "crash") {
        return makeResult(name, "negative", outcome, "fail", "compiler crashed");
    }
    if (outcome.outcome === "unavailable") {
        return makeResult(name, "negative", outcome, "fail", "compiler became unavailable");
    }
    if (outcome.input_changes !== undefined && outcome.input_changes.length > 0) {
        const changed = outcome.input_changes.join(", ");
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            `staged source changed during compilation: ${changed}`,
        );
    }
    if (outcome.returncode === 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            "negative fixture was unexpectedly accepted",
        );
    }

    const markers = item.diagnostic_markers;
    const errors: string[] = [];
    const unparsedErrors: string[] = [];
    for (const line of outcome.output.split(LINE_BREAK)) {
        // Educational notes hanging off a primary diagnostic repeat its text inside a
        // tree drawing; counting them again would double-report the same error.
        if (line.includes("`- error:") || line.includes("|- error:")) {
            continue;
        }
        const match = DIAGNOSTIC_PATTERN.exec(line);
        if (match !== null) {
            errors.push(match[1]);
        } else if (line.includes("error:")) {
            unparsedErrors.push(line);
        }
    }
    if (unparsedErrors.length > 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            `unparsed error diagnostic(s): ${unparsedErrors.join("; ")}`,
        );
    }
    if (errors.length === 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            "compiler failed without a source error diagnostic",
        );
    }
    // The driver's own "emit-module command failed" summary is not a source
    // diagnostic; a rejection proven only by that line proves nothing specific.
    const sourceErrors = errors.filter(message => !DRIVER_SUMMARY_PATTERN.test(message));
    if (sourceErrors.length === 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            "compiler failed without a source error diagnostic",
        );
    }
    const missing = markers.filter(
        marker => !sourceErrors.some(message => message.includes(marker)),
    );
    if (missing.length > 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            `missing diagnostic marker(s): ${missing.join(", ")}`,
        );
    }
    // An extra, unrelated error means the fixture failed for a second reason; the
    // declared rejection is then not the only thing the compiler proved.
    const unrelated = sourceErrors.filter(
        message => !markers.some(marker => message.includes(marker)),
    );
    if (unrelated.length > 0) {
        return makeResult(
            name,
            "negative",
            outcome,
            "fail",
            `unrelated error diagnostic(s): ${unrelated.join("; ")}`,
        );
    }
    return makeResult(name, "negative", outcome, "pass", "rejected with the expected diagnostic");
}

export function runChecks(
    manifestPath: string,
    swiftc: string | null,
    timeout: number,
): CompileReport {
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new ManifestError("timeout must be a finite positive number");
    }
    let manifestBytes: Buffer;
    try {
        manifestBytes = readFileSync(manifestPath);
    } catch (error) {
        throw new ManifestError(`cannot read manifest: ${errorMessage(error)}`);
    }
    const manifest = parseManifest(manifestBytes);
    const inputs = resolveInputs(manifestPath, manifest);
    const snapshots = sourceSnapshots(manifestPath, manifest);
    const sourceDigests: Record<string, string> = {};
    for (const [source, contents] of snapshots) {
        sourceDigests[source] = sha256(contents);
    }
    const report: CompileReport = {
        schema_version: 1,
        status: "fail",
        phase: "emit-module ownership checking",
        toolchain: { path: swiftc, version: null, parsed_version: null },
        snapshot: {
            manifest: path.resolve(manifestPath),
            sha256: sha256(manifestBytes),
            sources: sourceDigests,
        },
        inputs,
        results: [],
        limitations: [
            "Compiler rejection proves only the listed source snapshot, flags, and diagnostic markers.",
            "Compiler source paths refer to temporary snapshot copies; path-sensitive behavior and settings require separate build evidence.",
            "Prebuilt modules, SDK contents, plugins, response files, and other compiler-argument dependencies are not included in the snapshot digest.",
            "Runtime validation, serialization, interoperability, availability, and unsafe escape hatches require separate evidence.",
        ],
    };
    if (swiftc === null) {
        report.status = "unavailable";
        report.limitations.unshift("swiftc was not found; no compile-time claim was checked.");
        return report;
    }

    const versionProcess = runProcess(
        [swiftc, "--version"],
        path.dirname(manifestPath),
        Math.max(timeout, 5),
    );
    if (versionProcess.outcome !== "completed" || versionProcess.returncode !== 0) {
        report.status = "unavailable";
        report.toolchain.version = versionProcess.output.trim() || null;
        report.limitations.unshift(
            "The compiler version was unavailable; no compile-time claim was checked.",
        );
        return report;
    }
    const versionOutput = versionProcess.output.trim();
    report.toolchain.version = versionOutput;
    const parsed = parseSwiftVersion(versionOutput);
    if (parsed === null) {
        report.status = "unavailable";
        report.limitations.unshift(
            "The compiler version could not be parsed; no compile-time claim was checked.",
        );
        return report;
    }
    report.toolchain.parsed_version = parsed.join(".");
    if (compareVersions(parsed, paddedVersion(manifest.minimum_swift_version)) < 0) {
        report.status = "unavailable";
        report.limitations.unshift(
            `Swift ${manifest.minimum_swift_version} or newer is required; no current-toolchain claim was checked.`,
        );
        return report;
    }

    const root = path.dirname(manifestPath);
    const compilerArguments = manifest.compiler_arguments;
    const support = manifest.support_sources;
    const results = report.results;
    const temporary = mkdtempSync(path.join(tmpdir(), "swift-compile-checks-"));
    try {
        let invocation = 0;
        // Every invocation re-stages pristine copies, so a compiler that rewrites its
        // own inputs is detected instead of silently poisoning the checks that follow.
        const invoke = (buildCommand: (staged: Map<string, string>) => string[]): ProcessResult => {
            invocation += 1;
            const staged = stageSources(
                path.join(temporary, "inputs", String(invocation)),
                snapshots,
            );
            const outcome = runProcess(buildCommand(staged), root, timeout);
            outcome.input_changes = changedStagedSources(staged, snapshots);
            return outcome;
        };

        const controls = new Map<string, CheckResult>();
        for (const control of manifest.positive_controls) {
            const outcome = invoke(staged =>
                compileCommand(swiftc, staged, temporary, compilerArguments, support, control),
            );
            const result = evaluatePositive(control.name, outcome);
            controls.set(control.name, result);
            results.push(result);
        }

        for (const fixture of manifest.negative_fixtures) {
            // A broken control makes its negative fixture meaningless: the rejection
            // could come from the shared sources rather than the declared misuse.
            const paired = controls.get(fixture.positive_control);
            if (paired === undefined || paired.status !== "pass") {
                results.push({
                    name: fixture.name,
                    kind: "negative",
                    status: "fail",
                    reason: `paired positive control ${fixture.positive_control} is broken`,
                    returncode: null,
                    command: [],
                    diagnostics: "",
                });
                continue;
            }
            const outcome = invoke(staged =>
                compileCommand(swiftc, staged, temporary, compilerArguments, support, fixture),
            );
            results.push(evaluateNegative(fixture, outcome));
        }

        for (const check of manifest.runtime_checks) {
            const executable = path.join(temporary, moduleName(check.name));
            const compileOutcome = invoke(staged => [
                swiftc,
                ...check.compiler_arguments,
                ...sourcePaths(staged, support, check.sources),
                "-o",
                executable,
            ]);
            const compileResult = evaluatePositive(check.name, compileOutcome);
            compileResult.kind = "runtime-build";
            results.push(compileResult);
            if (compileResult.status === "pass") {
                const run = runProcess([executable], root, timeout);
                const status =
                    run.outcome === "completed" && run.returncode === 0 ? "pass" : "fail";
                results.push(
                    makeResult(
                        check.name,
                        "runtime",
                        run,
                        status,
                        status === "pass" ? "completed" : "runtime check failed",
                    ),
                );
            }
        }
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }

    report.status = results.every(item => item.status === "pass") ? "pass" : "fail";
    return report;
}

const RESULT_VERBS: Record<string, string> = {
    positive: "COMPILE",
    negative: "REJECT",
    "runtime-build": "BUILD",
    runtime: "RUN",
};

export function printHuman(report: CompileReport, allowUnavailable = false): void {
    if (report.status === "unavailable") {
        const prefix = allowUnavailable ? "SKIP" : "UNAVAILABLE";
        console.log(`${prefix}: ${report.limitations[0]}`);
        return;
    }
    const version = report.toolchain.version ?? "";
    console.log(
        `TOOLCHAIN  ${(version === "" ? "unknown toolchain" : version).split(LINE_BREAK)[0]}`,
    );
    console.log(`SNAPSHOT   ${report.snapshot.sha256}  ${report.snapshot.manifest}`);
    console.log(`PHASE      ${report.phase}`);
    for (const result of report.results) {
        const verb = RESULT_VERBS[result.kind] ?? "CHECK";
        console.log(
            `${verb.padEnd(10)} ${result.name}: ${result.status.toUpperCase()} — ${result.reason}`,
        );
        if (result.status === "fail" && result.diagnostics !== "") {
            console.error(result.diagnostics.trimEnd());
        }
    }
    for (const limitation of report.limitations) {
        console.log(`LIMITATION ${limitation}`);
    }
    if (report.status === "pass") {
        console.log("PASS: manifest controls and negative fixtures behaved as declared.");
    } else {
        console.error("FAIL: one or more compile checks did not establish the declared evidence.");
    }
}

const USAGE = `usage: swift_compile_checks.ts [-h] [--swiftc SWIFTC] [--timeout TIMEOUT] [--json]
                               [--allow-unavailable]
                               [manifest]

${DESCRIPTION}

positional arguments:
  manifest

options:
  -h, --help           show this help message and exit
  --swiftc SWIFTC      Compiler path; defaults to SWIFTC or PATH lookup
  --timeout TIMEOUT    Seconds allowed for each compiler or runtime process
  --json               Write the complete machine-readable report
  --allow-unavailable  Exit successfully when the compiler or required version is
                       unavailable`;

export interface CommandOptions {
    manifest: string;
    swiftc: string | null;
    timeout: number;
    json: boolean;
    allowUnavailable: boolean;
}

export function defaultManifestPath(): string {
    return path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "examples",
        "compile-checks.json",
    );
}

/** The documented `--timeout` contract: a finite, positive number of seconds. */
export function positiveFiniteFloat(raw: string): number {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
        throw new ManifestError("--timeout must be a finite positive number");
    }
    return value;
}

export function parseCommandLine(argv: string[]): CommandOptions | "help" {
    const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            swiftc: { type: "string" },
            timeout: { type: "string" },
            json: { type: "boolean" },
            "allow-unavailable": { type: "boolean" },
        },
    });
    if (parsed.values.help === true) {
        return "help";
    }
    if (parsed.positionals.length > 1) {
        throw new ManifestError(`unrecognized arguments: ${parsed.positionals.slice(1).join(" ")}`);
    }
    return {
        manifest: parsed.positionals[0] ?? defaultManifestPath(),
        swiftc: parsed.values.swiftc ?? null,
        timeout:
            parsed.values.timeout === undefined ? 30 : positiveFiniteFloat(parsed.values.timeout),
        json: parsed.values.json === true,
        allowUnavailable: parsed.values["allow-unavailable"] === true,
    };
}

export function expandUser(value: string): string {
    if (value === "~") {
        return homedir();
    }
    return value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

/** PATH lookup for an executable. */
export function which(program: string): string | null {
    const candidates = program.includes(path.sep)
        ? [program]
        : (process.env.PATH ?? "")
              .split(path.delimiter)
              .filter(entry => entry !== "")
              .map(entry => path.join(entry, program));
    for (const candidate of candidates) {
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

export function main(argv: string[] = process.argv.slice(2)): number {
    let options: CommandOptions | "help";
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
    const manifestPath = path.resolve(expandUser(options.manifest));
    const requested = options.swiftc ?? process.env.SWIFTC ?? "";
    const swiftc = requested === "" ? which("swiftc") : requested;
    let report: CompileReport;
    try {
        report = runChecks(manifestPath, swiftc, options.timeout);
    } catch (error) {
        report = {
            schema_version: 1,
            status: "fail",
            phase: "manifest validation",
            toolchain: { path: swiftc, version: null, parsed_version: null },
            snapshot: { manifest: manifestPath, sha256: null },
            inputs: null,
            results: [],
            limitations: [errorMessage(error)],
        };
    }
    if (options.json) {
        console.log(sortedJson(report));
    } else {
        printHuman(report, options.allowUnavailable);
    }
    if (report.status === "pass") {
        return 0;
    }
    if (report.status === "unavailable") {
        return options.allowUnavailable ? 0 : 2;
    }
    return 1;
}

// realpathSync keeps the entry-point comparison honest when the script is reached
// through a symlinked directory such as macOS /tmp.
if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = main();
}
