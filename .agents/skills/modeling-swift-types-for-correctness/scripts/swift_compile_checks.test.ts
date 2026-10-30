import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    ManifestError,
    type ProcessResult,
    changedStagedSources,
    compareVersions,
    compileCommand,
    evaluateNegative,
    evaluatePositive,
    moduleName,
    paddedVersion,
    parseCommandLine,
    parseManifest,
    parseSwiftVersion,
    positiveFiniteFloat,
    sortedJson,
    stageSources,
    validateCompilerArguments,
} from "./swift_compile_checks.ts";

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");

function baseManifest(): Record<string, unknown> {
    return {
        schema_version: 1,
        minimum_swift_version: "6.3",
        compiler_arguments: ["-emit-module", "-swift-version", "6"],
        support_sources: ["Shared.swift"],
        positive_controls: [{ name: "Control", sources: ["Pass.swift"] }],
        negative_fixtures: [
            {
                name: "Fixture",
                sources: ["Fail.swift"],
                positive_control: "Control",
                diagnostic_markers: ["cannot convert value of type"],
            },
        ],
    };
}

function completed(returncode: number, output: string): ProcessResult {
    return { outcome: "completed", returncode, output, command: ["swiftc"] };
}

test("the bundled manifest parses", () => {
    const manifest = parseManifest(readFileSync(path.join(EXAMPLES, "compile-checks.json")));
    assert.equal(manifest.minimum_swift_version, "6.3");
    assert.equal(manifest.positive_controls.length, 5);
    assert.equal(manifest.negative_fixtures.length, 5);
    assert.equal(manifest.runtime_checks.length, 1);
    for (const fixture of manifest.negative_fixtures) {
        assert.ok(
            manifest.positive_controls.some(control => control.name === fixture.positive_control),
        );
    }
});

test("manifest validation rejects malformed documents", () => {
    const cases: [string, (manifest: Record<string, unknown>) => void, string][] = [
        [
            "unknown field",
            manifest => void (manifest.extra = 1),
            "manifest has unknown field(s): extra",
        ],
        [
            "schema version",
            manifest => void (manifest.schema_version = 2),
            "schema_version must be 1",
        ],
        [
            "version syntax",
            manifest => void (manifest.minimum_swift_version = "six"),
            "minimum_swift_version must be a dotted version string",
        ],
        [
            "version floor",
            manifest => void (manifest.minimum_swift_version = "6.2"),
            "minimum_swift_version must be 6.3 or newer",
        ],
        [
            "missing phase",
            manifest => void (manifest.compiler_arguments = ["-swift-version", "6"]),
            "compiler_arguments must include -emit-module",
        ],
        [
            "typecheck phase",
            manifest =>
                void (manifest.compiler_arguments = [
                    "-emit-module",
                    "-typecheck",
                    "-swift-version",
                    "6",
                ]),
            "compiler_arguments must not include -typecheck with the emit-module phase",
        ],
        [
            "missing language mode",
            manifest => void (manifest.compiler_arguments = ["-emit-module"]),
            "compiler_arguments must contain exactly one -swift-version option",
        ],
        [
            "wrong language mode",
            manifest =>
                void (manifest.compiler_arguments = ["-emit-module", "-swift-version", "5"]),
            "compiler_arguments must select Swift 6 language mode",
        ],
        [
            "empty support sources",
            manifest => void (manifest.support_sources = []),
            "support_sources must not be empty",
        ],
        [
            "duplicate control names",
            manifest =>
                void (manifest.positive_controls = [
                    { name: "Control", sources: ["a.swift"] },
                    { name: "Control", sources: ["b.swift"] },
                ]),
            "positive_controls[1].name must be unique and nonempty",
        ],
        [
            "unpaired fixture",
            manifest =>
                void (manifest.negative_fixtures = [
                    {
                        name: "Fixture",
                        sources: ["Fail.swift"],
                        positive_control: "Absent",
                        diagnostic_markers: ["x"],
                    },
                ]),
            "negative_fixtures[0].positive_control must name a declared positive control",
        ],
        [
            "fixture without markers",
            manifest =>
                void (manifest.negative_fixtures = [
                    {
                        name: "Fixture",
                        sources: ["Fail.swift"],
                        positive_control: "Control",
                        diagnostic_markers: [],
                    },
                ]),
            "negative_fixtures[0].diagnostic_markers must not be empty",
        ],
    ];
    for (const [label, mutate, message] of cases) {
        const manifest = baseManifest();
        mutate(manifest);
        assert.throws(
            () => parseManifest(JSON.stringify(manifest)),
            new ManifestError(message),
            label,
        );
    }
});

test("compiler arguments must pin the emit-module phase and Swift 6", () => {
    assert.doesNotThrow(() => validateCompilerArguments(["-emit-module", "-swift-version", "6"]));
    assert.throws(
        () =>
            validateCompilerArguments([
                "-emit-module",
                "-swift-version",
                "6",
                "-swift-version",
                "6",
            ]),
        ManifestError,
    );
    assert.throws(
        () => validateCompilerArguments(["-emit-module", "-swift-version"]),
        ManifestError,
    );
});

test("version strings pad and compare like the manifest rule", () => {
    assert.deepEqual(paddedVersion("6.3"), [6, 3, 0]);
    assert.deepEqual(paddedVersion("6.4.1"), [6, 4, 1]);
    assert.equal(compareVersions([6, 3, 0], [6, 3, 0]), 0);
    assert.equal(compareVersions([6, 2, 9], [6, 3, 0]), -1);
    assert.equal(compareVersions([6, 10, 0], [6, 9, 0]), 1);
    assert.deepEqual(
        parseSwiftVersion("Apple Swift version 6.4 (swiftlang-6.4.0.34.1)"),
        [6, 4, 0],
    );
    assert.deepEqual(parseSwiftVersion("Swift version 6.3.1"), [6, 3, 1]);
    assert.equal(parseSwiftVersion("no version here"), null);
});

test("module names stay valid Swift identifiers", () => {
    assert.equal(moduleName("CorrectIdentifierDomain"), "Fixture_CorrectIdentifierDomain");
    assert.equal(moduleName("wrong id-check.1"), "Fixture_wrong_id_check_1");
});

test("positive controls fail for every unusable compiler outcome", () => {
    assert.equal(
        evaluatePositive("c", { outcome: "timeout", returncode: null, output: "", command: [] })
            .reason,
        "compiler timed out",
    );
    assert.equal(
        evaluatePositive("c", { outcome: "crash", returncode: null, output: "", command: [] })
            .reason,
        "compiler crashed",
    );
    assert.equal(
        evaluatePositive("c", { outcome: "unavailable", returncode: null, output: "", command: [] })
            .reason,
        "compiler became unavailable",
    );
    const mutated = evaluatePositive("c", { ...completed(0, ""), input_changes: ["Shared.swift"] });
    assert.equal(mutated.status, "fail");
    assert.equal(mutated.reason, "staged source changed during compilation: Shared.swift");
    assert.equal(
        evaluatePositive("c", completed(1, "boom")).reason,
        "positive control did not compile",
    );
    const passed = evaluatePositive("c", completed(0, ""));
    assert.equal(passed.status, "pass");
    assert.equal(passed.kind, "positive");
});

test("negative fixtures pass only on the declared diagnostic", () => {
    const item = { name: "WrongID", diagnostic_markers: ["cannot convert value of type"] };
    const rejected = evaluateNegative(
        item,
        completed(
            1,
            "/tmp/a/Fail.swift:3:17: error: cannot convert value of type 'OrderID' to 'UserID'",
        ),
    );
    assert.equal(rejected.status, "pass");
    assert.equal(rejected.reason, "rejected with the expected diagnostic");

    assert.equal(
        evaluateNegative(item, completed(0, "")).reason,
        "negative fixture was unexpectedly accepted",
    );
    assert.equal(
        evaluateNegative(
            item,
            completed(1, "/tmp/a/Fail.swift:3:17: error: use of unresolved identifier 'x'"),
        ).reason,
        "missing diagnostic marker(s): cannot convert value of type",
    );
    assert.equal(
        evaluateNegative(item, completed(1, "no diagnostics at all")).reason,
        "compiler failed without a source error diagnostic",
    );
    assert.equal(
        evaluateNegative(
            item,
            completed(
                1,
                "error: emit-module command failed with exit code 1 (use -v to see invocation)",
            ),
        ).reason,
        "compiler failed without a source error diagnostic",
    );
    assert.equal(
        evaluateNegative(
            item,
            completed(
                1,
                [
                    "/tmp/a/Fail.swift:3:17: error: cannot convert value of type 'OrderID' to 'UserID'",
                    "/tmp/a/Fail.swift:9:1: error: missing argument for parameter #1 in call",
                ].join("\n"),
            ),
        ).reason,
        "unrelated error diagnostic(s): missing argument for parameter #1 in call",
    );
    const unparsed = evaluateNegative(
        item,
        completed(1, "  error: something the pattern cannot anchor"),
    );
    assert.equal(unparsed.status, "fail");
    assert.match(unparsed.reason, /^unparsed error diagnostic\(s\): /);
});

test("diagnostic tree notes are not counted as separate errors", () => {
    const item = { name: "WrongTypestate", diagnostic_markers: ["be equivalent"] };
    const output = [
        "/tmp/a/Fail.swift:5:9: error: requires the types 'A' and 'B' be equivalent",
        "    5 |     finish(draft)",
        "      |            `- error: requires the types 'A' and 'B' be equivalent",
        "error: emit-module command failed with exit code 1 (use -v to see invocation)",
    ].join("\n");
    assert.equal(evaluateNegative(item, completed(1, output)).status, "pass");
});

test("staging copies sources and detects in-place rewrites", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "compile-checks-test-"));
    try {
        const snapshots = new Map([
            ["Shared.swift", Buffer.from("let shared = 1\n", "utf-8")],
            ["Pass.swift", Buffer.from("let pass = 2\n", "utf-8")],
        ]);
        const staged = stageSources(path.join(directory, "inputs", "1"), snapshots);
        assert.equal(staged.size, 2);
        assert.deepEqual(changedStagedSources(staged, snapshots), []);
        const stagedShared = staged.get("Shared.swift");
        assert.ok(stagedShared !== undefined);
        assert.equal(path.basename(stagedShared), "Shared.swift");
        writeFileSync(stagedShared, "let shared = 99\n");
        assert.deepEqual(changedStagedSources(staged, snapshots), ["Shared.swift"]);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("compile commands name the module and keep support sources first", () => {
    const staged = new Map([
        ["Shared.swift", "/staged/0/Shared.swift"],
        ["Fail.swift", "/staged/1/Fail.swift"],
    ]);
    const command = compileCommand(
        "/usr/bin/swiftc",
        staged,
        "/tmp/work",
        ["-emit-module", "-swift-version", "6"],
        ["Shared.swift"],
        { name: "WrongID", sources: ["Fail.swift"] },
    );
    assert.deepEqual(command, [
        "/usr/bin/swiftc",
        "-emit-module",
        "-swift-version",
        "6",
        "-module-name",
        "Fixture_WrongID",
        "-emit-module-path",
        path.join("/tmp/work", "Fixture_WrongID.swiftmodule"),
        "/staged/0/Shared.swift",
        "/staged/1/Fail.swift",
    ]);
});

test("reports serialize with sorted keys", () => {
    assert.equal(
        sortedJson({ b: 1, a: [true, null] }),
        '{\n  "a": [\n    true,\n    null\n  ],\n  "b": 1\n}',
    );
    assert.equal(sortedJson({ empty: {}, list: [] }), '{\n  "empty": {},\n  "list": []\n}');
});

test("the command line keeps the documented defaults", () => {
    const options = parseCommandLine([]);
    assert.notEqual(options, "help");
    if (options === "help") {
        return;
    }
    assert.equal(options.timeout, 30);
    assert.equal(options.json, false);
    assert.equal(options.allowUnavailable, false);
    assert.equal(options.swiftc, null);
    assert.equal(path.basename(options.manifest), "compile-checks.json");

    const explicit = parseCommandLine([
        "checks.json",
        "--swiftc",
        "/bin/swiftc",
        "--timeout",
        "12.5",
        "--json",
        "--allow-unavailable",
    ]);
    assert.deepEqual(explicit, {
        manifest: "checks.json",
        swiftc: "/bin/swiftc",
        timeout: 12.5,
        json: true,
        allowUnavailable: true,
    });
    assert.equal(parseCommandLine(["--help"]), "help");
    assert.throws(() => parseCommandLine(["--timeout", "0"]), ManifestError);
    assert.throws(() => parseCommandLine(["--timeout", "nope"]), ManifestError);
});

test("timeouts must be finite and positive", () => {
    assert.equal(positiveFiniteFloat("45"), 45);
    assert.throws(() => positiveFiniteFloat("-1"), ManifestError);
    assert.throws(() => positiveFiniteFloat("Infinity"), ManifestError);
    assert.throws(() => positiveFiniteFloat(""), ManifestError);
});
