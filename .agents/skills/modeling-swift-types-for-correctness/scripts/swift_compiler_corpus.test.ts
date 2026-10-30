import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ProcessResult } from "./swift_compile_checks.ts";

import {
    type CorpusCase,
    CorpusError,
    DEFAULT_MANIFEST,
    compilerCommand,
    evaluateCase,
    fixtureSources,
    parseCommandLine,
    readJson,
    runtimeCompiler,
    validateManifest,
} from "./swift_compiler_corpus.ts";

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");

function syntheticCase(index: number): Record<string, unknown> {
    return {
        suite: "core",
        name: `case_${index}`,
        lane: "default",
        source: { kind: "file", path: "core_examples.swift" },
        compiler_arguments: [],
        expected_outcome: "compile_success",
        diagnostic_markers: [],
        supplied_6_4_1: { accepted: true, expectation_met: true },
        note: "",
        positive_control: "control:default",
    };
}

function syntheticManifest(): Record<string, unknown> {
    return {
        schema_version: 1,
        cases: Array.from({ length: 89 }, (_unused, index) => syntheticCase(index)),
        runtime_checks: [
            { name: "core_runtime", source: "core_examples_runtime.swift", expected_stdout: "ok" },
            { name: "modeling_runtime", source: "modeling_examples.swift", expected_stdout: "ok" },
        ],
    };
}

function corpusCase(overrides: Partial<CorpusCase> = {}): CorpusCase {
    return {
        suite: "core",
        name: "wrong_identity",
        lane: "default",
        source: { kind: "file", path: "core_examples.swift" },
        compiler_arguments: [],
        expected_outcome: "compile_error",
        diagnostic_markers: ["cannot convert value of type"],
        supplied_6_4_1: { accepted: false },
        positive_control: "control:default",
        ...overrides,
    };
}

function completed(returncode: number, output: string): ProcessResult {
    return { outcome: "completed", returncode, output, command: ["swift-frontend"] };
}

test("the bundled corpus map validates", () => {
    const [manifest] = readJson(DEFAULT_MANIFEST);
    const validated = validateManifest(manifest);
    assert.equal(validated.cases.length, 89);
    assert.equal(validated.runtime_checks.length, 2);
    const identities = new Set(validated.cases.map(item => `${item.suite}:${item.name}`));
    assert.equal(identities.size, 89);
});

test("corpus fixtures resolve and keep their recorded hashes", () => {
    const [manifest] = readJson(DEFAULT_MANIFEST);
    const validated = validateManifest(manifest);
    const [snapshots, resolved] = fixtureSources(path.join(EXAMPLES, "compiler-corpus"), validated);
    assert.equal(snapshots.size, 91);
    assert.ok("frontier_manifest" in resolved);
    for (const item of validated.cases) {
        const key = `${item.suite}:${item.name}`;
        assert.ok(snapshots.has(key), key);
        assert.match(resolved[key].sha256, /^[0-9a-f]{64}$/);
    }
});

test("manifest validation holds the corpus shape", () => {
    const cases: [string, (manifest: Record<string, unknown>) => void, string][] = [
        ["schema", manifest => void (manifest.schema_version = 2), "schema_version must be 1"],
        [
            "case count",
            manifest =>
                void (manifest.cases = Array.from({ length: 88 }, (_unused, index) =>
                    syntheticCase(index),
                )),
            "manifest must map exactly 89 compiler cases",
        ],
        [
            "runtime count",
            manifest => void (manifest.runtime_checks = []),
            "manifest must map exactly two runtime checks",
        ],
        [
            "unique identities",
            manifest => void (manifest.cases = Array.from({ length: 89 }, () => syntheticCase(0))),
            "compiler case identities must be complete and unique",
        ],
    ];
    for (const [label, mutate, message] of cases) {
        const manifest = syntheticManifest();
        mutate(manifest);
        assert.throws(() => validateManifest(manifest), new CorpusError(message), label);
    }
});

test("per-case validation rejects unusable declarations", () => {
    const mutations: [Record<string, unknown>, string][] = [
        [{ lane: "other" }, "invalid lane for case_0"],
        [{ compiler_arguments: [""] }, "invalid compiler arguments for case_0"],
        [
            { lane: "experimental", compiler_arguments: [] },
            "experimental case has no feature flag: case_0",
        ],
        [{ expected_outcome: "compile_maybe" }, "invalid expected outcome for case_0"],
        [{ diagnostic_markers: [1] }, "invalid diagnostic markers for case_0"],
        [
            { expected_outcome: "compile_error", diagnostic_markers: [] },
            "negative case lacks a marker or control: case_0",
        ],
        [
            { expected_outcome: "compile_error", diagnostic_markers: ["x"], positive_control: "" },
            "negative case lacks a marker or control: case_0",
        ],
    ];
    for (const [overrides, message] of mutations) {
        const manifest = syntheticManifest();
        const cases = manifest.cases;
        assert.ok(Array.isArray(cases));
        cases[0] = { ...syntheticCase(0), ...overrides };
        assert.throws(() => validateManifest(manifest), new CorpusError(message), message);
    }
});

test("negative cases accept a recorded compatible diagnostic set", () => {
    const item = corpusCase();
    const output = "/tmp/case-0.swift:9:1: error: the newer wording for the same rejection";
    const strict = evaluateCase(item, completed(1, output), {});
    assert.equal(strict.status, "fail");
    assert.equal(strict.diagnostic_evidence, "supplied-6.4.1");

    const compatible = evaluateCase(item, completed(1, output), {
        "core:wrong_identity": [["the newer wording for the same rejection"]],
    });
    assert.equal(compatible.status, "pass");
    assert.equal(compatible.diagnostic_evidence, "compatible-toolchain");
    assert.equal(compatible.observed_accepted, false);
    assert.equal(compatible.deviates_from_supplied_6_4_1, false);
});

test("positive cases enforce their declared diagnostic expectations", () => {
    const quiet = evaluateCase(
        corpusCase({
            name: "core_positive",
            expected_outcome: "compile_success_without_diagnostics",
            diagnostic_markers: [],
            supplied_6_4_1: { accepted: true },
        }),
        completed(0, "warning: something was printed"),
        {},
    );
    assert.equal(quiet.status, "fail");
    assert.equal(quiet.reason, "compiled with unexpected diagnostics");

    const warned = evaluateCase(
        corpusCase({
            name: "warns",
            expected_outcome: "compile_success_with_warning",
            diagnostic_markers: ["will never be executed"],
            supplied_6_4_1: { accepted: true },
        }),
        completed(0, "/tmp/case-1.swift:4:3: warning: code after 'return' will never be executed"),
        {},
    );
    assert.equal(warned.status, "pass");

    const missingWarning = evaluateCase(
        corpusCase({
            name: "warns",
            expected_outcome: "compile_success_with_warning",
            diagnostic_markers: ["will never be executed"],
            supplied_6_4_1: { accepted: true },
        }),
        completed(0, ""),
        {},
    );
    assert.equal(missingWarning.status, "fail");
    assert.equal(missingWarning.reason, "expected warning was not observed");
});

test("an outcome that disagrees with the supplied Swift 6.4.1 record is flagged", () => {
    const item = corpusCase();
    const accepted = evaluateCase(item, completed(0, ""), {});
    assert.equal(accepted.status, "fail");
    assert.equal(accepted.observed_accepted, true);
    assert.equal(accepted.deviates_from_supplied_6_4_1, true);

    const unavailable = evaluateCase(
        item,
        { outcome: "unavailable", returncode: null, output: "", command: [] },
        {},
    );
    assert.equal(unavailable.deviates_from_supplied_6_4_1, false);
});

test("compiler commands pin the emit-sil phase and Swift 6", () => {
    const command = compilerCommand(
        "/toolchain/swift-frontend",
        ["-sdk", "/SDK"],
        ["-target", "arm64-apple-macos15"],
        ["-enable-experimental-feature", "Example"],
        "/work/case-0.swift",
        "/work/case-0.sil",
        "/work/module-cache",
        "CorpusCase0",
    );
    assert.deepEqual(command, [
        "/toolchain/swift-frontend",
        "-emit-sil",
        "-swift-version",
        "6",
        "-sdk",
        "/SDK",
        "-module-cache-path",
        "/work/module-cache",
        "-module-name",
        "CorpusCase0",
        "-target",
        "arm64-apple-macos15",
        "-enable-experimental-feature",
        "Example",
        "/work/case-0.swift",
        "-o",
        "/work/case-0.sil",
    ]);
});

test("runtime builds prefer the driver next to the frontend", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "corpus-test-"));
    try {
        const frontend = path.join(directory, "swift-frontend");
        writeFileSync(frontend, "");
        assert.equal(runtimeCompiler(frontend), frontend);
        const driver = path.join(directory, "swiftc");
        writeFileSync(driver, "");
        assert.equal(runtimeCompiler(frontend), driver);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("the command line keeps the documented defaults", () => {
    const options = parseCommandLine([]);
    assert.notEqual(options, "help");
    if (options === "help") {
        return;
    }
    assert.equal(options.manifest, DEFAULT_MANIFEST);
    assert.equal(options.timeout, 45);
    assert.equal(options.compileTarget, null);
    assert.equal(options.report, null);
    assert.equal(options.json, false);

    const explicit = parseCommandLine([
        "map.json",
        "--swiftc",
        "/bin/swift-frontend",
        "--timeout",
        "10",
        "--compile-target",
        "arm64-apple-macos15",
        "--json",
        "--report",
        "/tmp/report.json",
    ]);
    assert.deepEqual(explicit, {
        manifest: "map.json",
        swiftc: "/bin/swift-frontend",
        timeout: 10,
        compileTarget: "arm64-apple-macos15",
        json: true,
        report: "/tmp/report.json",
    });
    assert.equal(parseCommandLine(["--help"]), "help");
});
