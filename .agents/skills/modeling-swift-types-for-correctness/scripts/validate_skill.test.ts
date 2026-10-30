import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    Validation,
    localTarget,
    minimalFrontmatterParse,
    parseCommandLine,
    parseScalar,
    validateCompileManifest,
    validateCurrentSwiftPolicy,
    validateNoPlaceholders,
    validateQualityEvals,
    validateTriggerEvals,
} from "./validate_skill.ts";

function withTemporaryRoot(body: (root: string) => void): void {
    const root = mkdtempSync(path.join(tmpdir(), "validate-skill-test-"));
    try {
        body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function manifestFixture(): Record<string, unknown> {
    return {
        schema_version: 1,
        minimum_swift_version: "6.3",
        compiler_arguments: ["-emit-module", "-swift-version", "6", "-strict-concurrency=complete"],
        support_sources: ["CorePatterns.swift"],
        positive_controls: [{ name: "Control", sources: ["CompilePassControl.swift"] }],
        negative_fixtures: [
            {
                name: "Fixture",
                sources: ["CompileFailFixture.swift"],
                positive_control: "Control",
                diagnostic_markers: ["cannot convert value of type"],
            },
        ],
    };
}

function writeManifest(root: string, manifest: Record<string, unknown>, fixtures: string[]): void {
    mkdirSync(path.join(root, "examples"), { recursive: true });
    writeFileSync(
        path.join(root, "examples", "compile-checks.json"),
        JSON.stringify(manifest, null, 2),
    );
    for (const fixture of fixtures) {
        writeFileSync(path.join(root, "examples", fixture), "// fixture\n");
    }
}

test("scalars lose matching quotes only", () => {
    assert.equal(parseScalar(' "quoted" '), "quoted");
    assert.equal(parseScalar("'single'"), "single");
    assert.equal(parseScalar('"unbalanced'), '"unbalanced');
    assert.equal(parseScalar("  bare  "), "bare");
});

test("the frontmatter subset parser handles this skill's shapes", () => {
    const parsed = minimalFrontmatterParse(
        [
            "# a comment",
            "name: modeling-swift-types-for-correctness",
            'description: "Model Swift invariants."',
            "compatibility: >-",
            "  Swift 6.3 or newer",
            "  with Xcode 26",
            "metadata:",
            "  version: 1.2.3",
            "  swift-baseline: 6.3+",
            "",
            "license: MIT",
        ].join("\n"),
    );
    assert.equal(parsed.name, "modeling-swift-types-for-correctness");
    assert.equal(parsed.description, "Model Swift invariants.");
    assert.equal(parsed.compatibility, "Swift 6.3 or newer with Xcode 26");
    assert.deepEqual(parsed.metadata, { version: "1.2.3", "swift-baseline": "6.3+" });
    assert.equal(parsed.license, "MIT");
});

test("the frontmatter parser refuses syntax it cannot model", () => {
    assert.throws(
        () => minimalFrontmatterParse("  indented: value"),
        /unsupported frontmatter syntax at line 1/,
    );
    assert.throws(
        () => minimalFrontmatterParse("name"),
        /unsupported frontmatter syntax at line 1/,
    );
    assert.throws(
        () => minimalFrontmatterParse("metadata:\n  broken"),
        /unsupported mapping syntax at line 2/,
    );
});

test("only local link targets are checked", () => {
    assert.equal(localTarget("https://example.com/page"), null);
    assert.equal(localTarget("mailto:someone@example.com"), null);
    assert.equal(localTarget("#anchor"), null);
    assert.equal(localTarget("  <references/sources.md>  "), "references/sources.md");
    assert.equal(localTarget("references/sources.md#section"), "references/sources.md");
    assert.equal(localTarget("references/sources.md?raw=1"), "references/sources.md");
    assert.equal(localTarget("references/compile%20check.md"), "references/compile check.md");
});

test("the compile manifest must stay wired to the fixtures on disk", () => {
    withTemporaryRoot(root => {
        writeManifest(root, manifestFixture(), ["CompileFailFixture.swift"]);
        const clean = new Validation();
        validateCompileManifest(root, clean);
        assert.deepEqual(clean.errors, []);

        const strayFixture = new Validation();
        writeFileSync(path.join(root, "examples", "CompileFailStray.swift"), "// stray\n");
        validateCompileManifest(root, strayFixture);
        assert.equal(strayFixture.errors.length, 1);
        assert.match(strayFixture.errors[0], /fixture set differs from disk/);
    });

    withTemporaryRoot(root => {
        const manifest = manifestFixture();
        manifest.minimum_swift_version = "6.2";
        manifest.compiler_arguments = ["-typecheck", "-swift-version", "6"];
        writeManifest(root, manifest, ["CompileFailFixture.swift"]);
        const validation = new Validation();
        validateCompileManifest(root, validation);
        assert.ok(
            validation.errors.some(message =>
                message.includes("emit-module ownership-checking phase"),
            ),
        );
        assert.ok(validation.errors.some(message => message.includes("Swift 6.3 minimum")));
        assert.ok(validation.errors.some(message => message.includes("strict-concurrency")));
    });

    withTemporaryRoot(root => {
        const manifest = manifestFixture();
        manifest.negative_fixtures = [
            {
                name: "Fixture",
                sources: ["CompileFailFixture.swift"],
                positive_control: "Absent",
                diagnostic_markers: [],
            },
        ];
        writeManifest(root, manifest, ["CompileFailFixture.swift"]);
        const validation = new Validation();
        validateCompileManifest(root, validation);
        assert.ok(
            validation.errors.some(message => message.includes("must declare diagnostic markers")),
        );
        assert.ok(
            validation.errors.some(message => message.includes("no valid paired positive control")),
        );
    });
});

test("the compatibility entry point must delegate to the compile runner", () => {
    withTemporaryRoot(root => {
        mkdirSync(path.join(root, "scripts"), { recursive: true });
        writeFileSync(
            path.join(root, "scripts", "check_examples.ts"),
            "// nothing delegated here\n",
        );
        const validation = new Validation();
        validateCurrentSwiftPolicy(root, validation);
        assert.equal(validation.errors.length, 1);
        assert.match(
            validation.errors[0],
            /must delegate compiler checks to swift_compile_checks\.ts/,
        );

        const delegating = new Validation();
        writeFileSync(
            path.join(root, "scripts", "check_examples.ts"),
            'import "./swift_compile_checks.ts";\n',
        );
        validateCurrentSwiftPolicy(root, delegating);
        assert.deepEqual(delegating.errors, []);
    });
});

test("placeholder tokens are rejected in shipped prose and sources", () => {
    withTemporaryRoot(root => {
        const token = "TO" + "DO";
        writeFileSync(path.join(root, "notes.md"), `line one\n${token}: finish this\n`);
        writeFileSync(path.join(root, "ignored.txt"), `${token}: not a shipped suffix\n`);
        const validation = new Validation();
        validateNoPlaceholders(root, validation);
        assert.equal(validation.errors.length, 1);
        assert.equal(validation.errors[0], `placeholder token ${token} in notes.md:2`);
    });
});

test("trigger evals need unique ids and both decisions", () => {
    withTemporaryRoot(root => {
        mkdirSync(path.join(root, "evals"), { recursive: true });
        const cases = [
            { id: "a", prompt: "p", should_trigger: true, reason: "r" },
            { id: "a", prompt: "p", should_trigger: true, reason: "r" },
            { id: "b", prompt: " ", should_trigger: "yes", reason: "" },
        ];
        writeFileSync(path.join(root, "evals", "trigger-evals.json"), JSON.stringify({ cases }));
        const validation = new Validation();
        validateTriggerEvals(root, validation);
        assert.ok(validation.errors.includes("duplicate trigger eval id: a"));
        assert.ok(validation.errors.includes("trigger eval case 3 has no prompt"));
        assert.ok(validation.errors.includes("trigger eval case 3 should_trigger must be Boolean"));
        assert.ok(validation.errors.includes("trigger eval case 3 has no reason"));
        assert.ok(
            validation.errors.includes(
                "trigger evals must contain both positive and negative cases",
            ),
        );
        assert.equal(validation.warnings.length, 1);
        assert.match(validation.warnings[0], /only 3 trigger evals/);
    });
});

test("quality evals need their section markers", () => {
    withTemporaryRoot(root => {
        mkdirSync(path.join(root, "evals"), { recursive: true });
        writeFileSync(path.join(root, "evals", "quality-evals.md"), "## 1. First\n\n**Prompt**\n");
        const validation = new Validation();
        validateQualityEvals(root, validation);
        assert.deepEqual(validation.errors, [
            "quality-evals.md is missing required section marker: **Must include**",
            "quality-evals.md is missing required section marker: **Must not include**",
        ]);
        assert.match(validation.warnings[0], /only 1 quality eval scenarios/);
    });
});

test("the command line keeps the documented defaults", () => {
    assert.deepEqual(parseCommandLine([]), { root: null, skipSwift: false, skipOfficial: false });
    assert.deepEqual(parseCommandLine([".", "--skip-swift", "--skip-official"]), {
        root: ".",
        skipSwift: true,
        skipOfficial: true,
    });
    assert.equal(parseCommandLine(["-h"]), "help");
});
