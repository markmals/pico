import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    countCharacters,
    describeSystemError,
    errorsOf,
    extractGoalBody,
    formatText,
    lintGoal,
    normalizeText,
    parseArguments,
    resultAsJson,
    runSelfTest,
    sectionCount,
    VALID_SELF_TEST_GOAL,
    warningsOf,
    type LintOptions,
} from "./lint_goal.ts";

let SCRIPT = fileURLToPath(new URL("lint_goal.ts", import.meta.url));

function codes(goal: string, options: LintOptions = {}): Set<string> {
    return new Set(lintGoal(goal, options).diagnostics.map(diagnostic => diagnostic.code));
}

function severityOf(goal: string, code: string): string | undefined {
    return lintGoal(goal).diagnostics.find(diagnostic => diagnostic.code === code)?.severity;
}

// Every rule is checked against a body that already satisfies the whole contract, so a
// failing assertion means the mutation under test caused the diagnostic, nothing else.
test("the reference goal is completely clean", () => {
    let result = lintGoal(VALID_SELF_TEST_GOAL);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.acceptanceCriteria, ["AC1", "AC2"]);
    assert.equal(errorsOf(result).length, 0);
    assert.equal(warningsOf(result).length, 0);
});

test("normalizeText strips the BOM and folds CRLF", () => {
    assert.equal(normalizeText("\ufeffa\r\nb\rc"), "a\nb\nc");
});

test("countCharacters counts code points, not UTF-16 units", () => {
    assert.equal(countCharacters("ab"), 2);
    assert.equal(countCharacters("a\u{1f680}b"), 3);
    assert.equal("a\u{1f680}b".length, 4);
});

test("sectionCount matches headings with and without hashes", () => {
    assert.equal(sectionCount("Objective: a\n## Objective: b\n   Objective : c", ["Objective"]), 3);
    assert.equal(sectionCount("objectives are nice", ["Objective"]), 0);
});

test("extractGoalBody unwraps a fenced block, the /goal line, and the count footer", () => {
    let fenced = "```text\n/goal\nObjective: Ship.\nCharacters: 1,234 / 4,000\n```";
    assert.deepEqual(extractGoalBody(fenced), { body: "Objective: Ship.", diagnostics: [] });

    let inline = extractGoalBody("/goal Objective: Ship.\nDone when: AC1: x. Proof: `y`.");
    assert.equal(inline.body, "Objective: Ship.\nDone when: AC1: x. Proof: `y`.");

    assert.equal(extractGoalBody("Objective: Ship.").body, "Objective: Ship.");
});

test("MULTIPLE_GOALS is reported first and leaves the body unsplit", () => {
    let twoGoals = "/goal\nObjective: First.\n/goal Objective: Second.";
    let extraction = extractGoalBody(twoGoals);
    assert.deepEqual(extraction.diagnostics, [
        {
            severity: "error",
            code: "MULTIPLE_GOALS",
            message: "Input contains more than one /goal command. Lint one goal body at a time.",
        },
    ]);
    assert.equal(extraction.body, twoGoals);

    // The remaining checks still run, so a two-goal paste reports everything it is missing.
    let result = lintGoal(twoGoals);
    assert.equal(result.diagnostics[0].code, "MULTIPLE_GOALS");
    assert.ok(codes(twoGoals).has("MISSING_ACCEPTANCE_CRITERIA"));
    assert.deepEqual(result.acceptanceCriteria, []);
});

test("EMPTY_GOAL is the only diagnostic for blank input", () => {
    let result = lintGoal("/goal\n   \n");
    assert.deepEqual(result.diagnostics, [
        { severity: "error", code: "EMPTY_GOAL", message: "Goal body is empty." },
    ]);
    assert.equal(result.characters, 0);
});

test("character budget arithmetic reports the measured body length", () => {
    let body = VALID_SELF_TEST_GOAL.trim().slice("/goal\n".length);
    let result = lintGoal(VALID_SELF_TEST_GOAL);
    assert.equal(result.characters, countCharacters(body));

    let overTarget = lintGoal(VALID_SELF_TEST_GOAL + "x".repeat(2200));
    assert.equal(overTarget.characters, countCharacters(body) + 2201);
    assert.deepEqual(
        overTarget.diagnostics.map(diagnostic => diagnostic.code),
        ["OVER_TARGET_LIMIT"],
    );
    assert.equal(
        overTarget.diagnostics[0].message,
        `Goal body is ${overTarget.characters} characters; target 3000 or fewer to preserve clarity and edit headroom.`,
    );

    let overHard = lintGoal(VALID_SELF_TEST_GOAL + "x".repeat(4001));
    assert.equal(severityOf(VALID_SELF_TEST_GOAL + "x".repeat(4001), "OVER_HARD_LIMIT"), "error");
    assert.equal(
        overHard.diagnostics[0].message,
        `Goal body is ${overHard.characters} characters; the hard limit is 4000.`,
    );
    assert.ok(!codes(VALID_SELF_TEST_GOAL + "x".repeat(4001)).has("OVER_TARGET_LIMIT"));
});

test("custom limits move both thresholds", () => {
    let tight: LintOptions = { maxCharacters: 500, targetCharacters: 200 };
    assert.ok(codes(VALID_SELF_TEST_GOAL, tight).has("OVER_HARD_LIMIT"));

    let loose: LintOptions = { maxCharacters: 100_000, targetCharacters: 90_000 };
    assert.ok(!codes(VALID_SELF_TEST_GOAL, loose).has("OVER_TARGET_LIMIT"));
});

test("objective checks require exactly one Objective section", () => {
    let missing = VALID_SELF_TEST_GOAL.replace(
        "Objective: Make the parser reject duplicate IDs.\n",
        "",
    );
    assert.ok(codes(missing).has("MISSING_OBJECTIVE"));
    assert.equal(severityOf(missing, "MISSING_OBJECTIVE"), "error");

    let doubled = VALID_SELF_TEST_GOAL.replace(
        "Objective: Make the parser reject duplicate IDs.",
        "Objective: Make the parser reject duplicate IDs.\nObjective: Also rewrite the lexer.",
    );
    assert.ok(codes(doubled).has("MULTIPLE_OBJECTIVES"));
    assert.equal(severityOf(doubled, "MULTIPLE_OBJECTIVES"), "error");
});

test("acceptance criteria are collected, deduplicated, and order-checked", () => {
    let pointer = "/goal Objective: Ship it. Review the plan in SPEC.md.";
    assert.ok(codes(pointer).has("MISSING_ACCEPTANCE_CRITERIA"));
    assert.ok(codes(pointer).has("DOCUMENT_WITHOUT_INLINE_CLOSURE"));

    let duplicated = VALID_SELF_TEST_GOAL.replace("- AC2: Existing", "- AC1: Existing");
    let duplicateResult = lintGoal(duplicated);
    assert.deepEqual(duplicateResult.acceptanceCriteria, ["AC1"]);
    assert.ok(
        duplicateResult.diagnostics.some(
            diagnostic =>
                diagnostic.code === "DUPLICATE_AC_IDS" &&
                diagnostic.message === "Acceptance-criterion IDs must be unique; duplicated: AC1.",
        ),
    );

    let nonsequential = VALID_SELF_TEST_GOAL.replaceAll("AC2", "AC5");
    assert.ok(codes(nonsequential).has("NONSEQUENTIAL_AC_IDS"));
    assert.equal(severityOf(nonsequential, "NONSEQUENTIAL_AC_IDS"), "warning");

    let many = VALID_SELF_TEST_GOAL.replace(
        "- AC2: Existing unique-ID fixtures still pass. Proof: `pytest tests/test_parser.py -k unique` exits 0.",
        Array.from(
            { length: 8 },
            (_unused, index) =>
                `- AC${index + 2}: Case ${index} holds. Proof: \`check ${index}\` exits 0.`,
        ).join("\n"),
    );
    let manyResult = lintGoal(many);
    assert.equal(manyResult.acceptanceCriteria.length, 9);
    assert.ok(
        manyResult.diagnostics.some(
            diagnostic =>
                diagnostic.code === "TOO_MANY_ACCEPTANCE_CRITERIA" &&
                diagnostic.message.startsWith("Found 9 criteria."),
        ),
    );
});

test("list markers, checkboxes, and separators all introduce a criterion", () => {
    let body = "/goal\n* [x] AC1: a\n+ AC2) b\n[ ] AC3. c\nAC4 - d";
    assert.deepEqual(lintGoal(body).acceptanceCriteria, ["AC1", "AC2", "AC3", "AC4"]);
});

test("MISSING_DONE_HEADING fires without an explicit closure heading", () => {
    let renamed = VALID_SELF_TEST_GOAL.replace("Done when:", "Checks:");
    assert.ok(codes(renamed).has("MISSING_DONE_HEADING"));
    assert.ok(
        !codes(VALID_SELF_TEST_GOAL.replace("Done when:", "Completion criteria:")).has(
            "MISSING_DONE_HEADING",
        ),
    );
});

test("evidence mapping distinguishes none, some, and all criteria", () => {
    let partial = VALID_SELF_TEST_GOAL.replace(
        " Proof: `pytest tests/test_parser.py -k unique` exits 0.",
        "",
    );
    assert.ok(
        lintGoal(partial).diagnostics.some(
            diagnostic =>
                diagnostic.code === "PARTIAL_EVIDENCE_MAP" &&
                diagnostic.message === "These criteria lack an explicit proof mapping: AC2.",
        ),
    );

    let none = partial.replace(" Proof: `pytest tests/test_parser.py -k duplicate` exits 0.", "");
    assert.ok(codes(none).has("MISSING_EVIDENCE_MAP"));
    assert.ok(!codes(none).has("PARTIAL_EVIDENCE_MAP"));

    // A shared Evidence section that names the criterion counts as a proof binding.
    let section = none + "\nEvidence: AC1 and AC2 are proven by `pytest tests/test_parser.py`.";
    assert.ok(!codes(section).has("MISSING_EVIDENCE_MAP"));
    assert.ok(!codes(section).has("PARTIAL_EVIDENCE_MAP"));
});

test("scope boundaries are required in both directions", () => {
    let noScope = VALID_SELF_TEST_GOAL.replace(
        "Scope:\n- In: parser and parser tests\n- Out: formatter changes\n",
        "",
    );
    assert.ok(codes(noScope).has("MISSING_SCOPE"));
    assert.ok(codes(noScope).has("MISSING_OUT_OF_SCOPE"));

    let noOut = VALID_SELF_TEST_GOAL.replace("- Out: formatter changes\n", "");
    assert.ok(!codes(noOut).has("MISSING_SCOPE"));
    assert.ok(codes(noOut).has("MISSING_OUT_OF_SCOPE"));
    assert.ok(!codes(noOut + "\nNon-goals: formatter changes.").has("MISSING_OUT_OF_SCOPE"));
});

test("MISSING_BASELINE_POLICY fires without a regression policy", () => {
    let stripped = VALID_SELF_TEST_GOAL.replace(
        "Baseline and regressions: Capture both tests before edits; new failures block and unrelated pre-existing failures do not.\n",
        "",
    );
    assert.ok(codes(stripped).has("MISSING_BASELINE_POLICY"));
    assert.ok(!codes(stripped + "\nNew regressions block success.").has("MISSING_BASELINE_POLICY"));
});

test("both terminal outcomes must be labeled", () => {
    let noSuccess = VALID_SELF_TEST_GOAL.replace("- SUCCESS:", "- Done:");
    assert.ok(codes(noSuccess).has("MISSING_SUCCESS_EXIT"));
    assert.equal(severityOf(noSuccess, "MISSING_SUCCESS_EXIT"), "error");

    let noBlocked = VALID_SELF_TEST_GOAL.replace("- BLOCKED:", "- Stuck:");
    assert.ok(codes(noBlocked).has("MISSING_BLOCKED_EXIT"));
    assert.equal(severityOf(noBlocked, "MISSING_BLOCKED_EXIT"), "error");
});

test("SUCCESS_DOES_NOT_STOP fires when success does not terminate the loop", () => {
    let lingering = VALID_SELF_TEST_GOAL.replace(
        "- SUCCESS: AC1 and AC2 pass with surfaced evidence; stop immediately.",
        "- SUCCESS: AC1 and AC2 pass with surfaced evidence.",
    ).replace("- BLOCKED: Stop without claiming success after", "- BLOCKED: Give up after");
    assert.ok(codes(lingering).has("SUCCESS_DOES_NOT_STOP"));
});

test("termination needs both a stagnation clause and an absolute turn cap", () => {
    let noStagnation = VALID_SELF_TEST_GOAL.replace(
        "3 consecutive turns with no new evidence, or 10 turns",
        "or 10 turns",
    );
    assert.ok(codes(noStagnation).has("MISSING_STAGNATION_EXIT"));
    assert.ok(!codes(noStagnation).has("MISSING_ABSOLUTE_CAP"));

    let noCap = VALID_SELF_TEST_GOAL.replace(", or 10 turns", "");
    assert.ok(codes(noCap).has("MISSING_ABSOLUTE_CAP"));
    assert.ok(!codes(noCap).has("MISSING_STAGNATION_EXIT"));

    let highCap = VALID_SELF_TEST_GOAL.replace("or 10 turns", "or 50 turns");
    assert.ok(
        lintGoal(highCap).diagnostics.some(
            diagnostic =>
                diagnostic.code === "TURN_CAP_TOO_HIGH" &&
                diagnostic.message.startsWith("Found a 50-turn cap."),
        ),
    );
    assert.ok(
        !codes(VALID_SELF_TEST_GOAL.replace("or 10 turns", "or 30 turns")).has("TURN_CAP_TOO_HIGH"),
    );
});

test("MUTABLE_CLOSURE_NOT_FORBIDDEN fires when the closure set is not frozen", () => {
    let thawed = VALID_SELF_TEST_GOAL.replace(
        "only AC1 and AC2 define completion",
        "the attached notes define completion",
    ).replace("Do not add criteria; record", "Record");
    assert.ok(codes(thawed).has("MUTABLE_CLOSURE_NOT_FORBIDDEN"));
    assert.ok(!codes(thawed + "\nThe closure set is fixed.").has("MUTABLE_CLOSURE_NOT_FORBIDDEN"));
});

test("EVIDENCE_NOT_SURFACED fires when proof never reaches the transcript", () => {
    let hidden = VALID_SELF_TEST_GOAL.replace(
        " In the final turn, surface commands, exit status, and results.",
        "",
    ).replace(
        "- SUCCESS: AC1 and AC2 pass with surfaced evidence;",
        "- SUCCESS: AC1 and AC2 pass;",
    );
    assert.ok(codes(hidden).has("EVIDENCE_NOT_SURFACED"));
    assert.ok(
        !codes(hidden + "\nQuote the evidence in the transcript.").has("EVIDENCE_NOT_SURFACED"),
    );
});

test("unbounded-scope phrases are errors", () => {
    let cases: [string, string][] = [
        ["POINTER_ONLY_COMPLETION", "Implement everything described in DESIGN.md."],
        ["DYNAMIC_SCOPE_TAIL", "Also fix anything else found during the work."],
        ["NO_POSSIBLE_IMPROVEMENTS", "Continue until no further improvements remain."],
        ["PERPETUAL_POLISH", "Keep polishing the renderer."],
    ];
    for (let [code, phrase] of cases) {
        let goal = `${VALID_SELF_TEST_GOAL}\n${phrase}`;
        assert.ok(codes(goal).has(code), `${code} should fire for: ${phrase}`);
        assert.equal(severityOf(goal, code), "error");
    }

    // A measurable threshold makes bounded iteration acceptable.
    assert.ok(
        !codes(`${VALID_SELF_TEST_GOAL}\nKeep improving until coverage reaches 90%.`).has(
            "PERPETUAL_POLISH",
        ),
    );
});

test("vague-quality phrases are warnings", () => {
    let cases: [string, string][] = [
        ["VAGUE_PRODUCTION_READY", "Make the exporter production-ready."],
        ["VAGUE_QUALITY", "Deliver the best possible implementation."],
        ["OPEN_EDGE_CASES", "Handle all edge cases in the tokenizer."],
        ["AS_NEEDED", "Refactor adjacent helpers as needed."],
        ["DYNAMIC_BACKLOG", "Close all currently open issues first."],
    ];
    for (let [code, phrase] of cases) {
        let goal = `${VALID_SELF_TEST_GOAL}\n${phrase}`;
        assert.ok(codes(goal).has(code), `${code} should fire for: ${phrase}`);
        assert.equal(severityOf(goal, code), "warning");
    }
});

test("UNRESOLVED_PLACEHOLDER fires once for either placeholder style", () => {
    let bracketed = `${VALID_SELF_TEST_GOAL}\n- AC3: [TODO] holds. Proof: [...]`;
    let placeholderCount = lintGoal(bracketed).diagnostics.filter(
        diagnostic => diagnostic.code === "UNRESOLVED_PLACEHOLDER",
    ).length;
    assert.equal(placeholderCount, 1);
    assert.equal(severityOf(bracketed, "UNRESOLVED_PLACEHOLDER"), "error");

    let angled = `${VALID_SELF_TEST_GOAL}\n- AC3: Latency beats <threshold>. Proof: \`bench\`.`;
    assert.ok(codes(angled).has("UNRESOLVED_PLACEHOLDER"));
});

test("the shipped single-goal template still fails on its own placeholders", () => {
    let template = [
        "```text",
        "/goal",
        "Objective: [One concrete outcome stated as an observable end state.]",
        "```",
    ].join("\n");
    assert.ok(codes(template).has("UNRESOLVED_PLACEHOLDER"));
});

test("a document reference is allowed once inline criteria exist", () => {
    assert.ok(!codes(VALID_SELF_TEST_GOAL).has("DOCUMENT_WITHOUT_INLINE_CLOSURE"));
    assert.ok(
        codes("/goal Objective: Do the work in PLAN.md.").has("DOCUMENT_WITHOUT_INLINE_CLOSURE"),
    );
});

test("diagnostic codes are deduplicated per severity", () => {
    let repeated = `${VALID_SELF_TEST_GOAL}\nHandle all edge cases.\nHandle every edge case.`;
    let seen = lintGoal(repeated).diagnostics.map(diagnostic => diagnostic.code);
    assert.equal(new Set(seen).size, seen.length);
});

test("formatText renders the summary header and every diagnostic", () => {
    assert.equal(
        formatText(lintGoal(VALID_SELF_TEST_GOAL, { source: "goal.txt" })),
        [
            "source: goal.txt",
            `characters: ${lintGoal(VALID_SELF_TEST_GOAL).characters} / 4000 (target <= 3000)`,
            "acceptance criteria: 2 (AC1, AC2)",
            "errors: 0; warnings: 0",
            "OK: no structural issues found",
        ].join("\n"),
    );

    let empty = formatText(lintGoal("/goal\n"));
    assert.equal(
        empty,
        [
            "source: <memory>",
            "characters: 0 / 4000 (target <= 3000)",
            "acceptance criteria: 0",
            "errors: 1; warnings: 0",
            "ERROR EMPTY_GOAL: Goal body is empty.",
        ].join("\n"),
    );
});

test("resultAsJson emits sorted keys and escapes non-ASCII", () => {
    let json = resultAsJson(lintGoal(VALID_SELF_TEST_GOAL, { source: "caf\u00e9.txt" }));
    assert.deepEqual(Object.keys(JSON.parse(json)), [
        "acceptance_criteria",
        "characters",
        "diagnostics",
        "max_characters",
        "source",
        "summary",
        "target_characters",
    ]);
    assert.ok(json.includes('"source": "caf\\u00e9.txt"'));

    let payload = JSON.parse(resultAsJson(lintGoal("/goal\n")));
    assert.deepEqual(payload.summary, { errors: 1, warnings: 0 });
    assert.deepEqual(Object.keys(payload.diagnostics[0]), ["code", "message", "severity"]);
});

test("parseArguments mirrors the documented flags", () => {
    assert.deepEqual(parseArguments([]), {
        path: "-",
        json: false,
        strict: false,
        maxChars: 4000,
        targetChars: 3000,
        selfTest: false,
    });
    assert.equal(parseArguments(["goal.txt"])?.path, "goal.txt");
    assert.equal(parseArguments(["-"])?.path, "-");
    assert.equal(parseArguments(["--json"])?.json, true);
    assert.equal(parseArguments(["--strict"])?.strict, true);
    assert.equal(parseArguments(["--self-test"])?.selfTest, true);
    assert.equal(parseArguments(["--max-chars", "900"])?.maxChars, 900);
    assert.equal(parseArguments(["--target-chars=120"])?.targetChars, 120);
    assert.equal(parseArguments(["--help"]), null);
    assert.equal(parseArguments(["-h"]), null);

    assert.throws(() => parseArguments(["--bogus"]), /unrecognized arguments: --bogus/);
    assert.throws(() => parseArguments(["a", "b"]), /unrecognized arguments: b/);
    assert.throws(
        () => parseArguments(["--max-chars", "abc"]),
        /argument --max-chars: invalid int value: 'abc'/,
    );
    assert.throws(() => parseArguments(["--max-chars"]), /expected one argument/);
});

test("describeSystemError reproduces the OSError wording", () => {
    let error = Object.assign(new Error("ENOENT: no such file or directory, open 'x'"), {
        code: "ENOENT",
        errno: -2,
    });
    assert.equal(
        describeSystemError(error, "x"),
        "Could not read x: [Errno 2] No such file or directory: 'x'",
    );
});

test("runSelfTest passes", () => {
    assert.equal(runSelfTest(), 0);
});

function runCli(args: string[], input = ""): { status: number; stdout: string; stderr: string } {
    let finished = spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
    return { status: finished.status ?? -1, stdout: finished.stdout, stderr: finished.stderr };
}

test("the CLI exit codes distinguish clean, warning, and error bodies", () => {
    let directory = mkdtempSync(path.join(tmpdir(), "lint-goal-"));
    let clean = path.join(directory, "clean.txt");
    writeFileSync(clean, VALID_SELF_TEST_GOAL);
    let warned = path.join(directory, "warned.txt");
    writeFileSync(warned, VALID_SELF_TEST_GOAL.replace(", or 10 turns", ""));

    assert.equal(runCli([clean]).status, 0);
    assert.equal(runCli([clean, "--strict"]).status, 0);
    assert.equal(runCli([warned]).status, 0);

    let strict = runCli([warned, "--strict"]);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /WARNING MISSING_ABSOLUTE_CAP/);

    let failing = runCli(["-"], "/goal\nObjective: Ship everything in SPEC.md.");
    assert.equal(failing.status, 2);
    assert.match(failing.stdout, /source: <stdin>/);
    assert.match(failing.stdout, /ERROR MISSING_ACCEPTANCE_CRITERIA/);

    let json = runCli([clean, "--json"]);
    assert.equal(json.status, 0);
    assert.equal(JSON.parse(json.stdout).source, clean);

    let selfTest = runCli(["--self-test"]);
    assert.equal(selfTest.status, 0);
    assert.equal(selfTest.stdout, "self-test: OK\n");
});

test("the CLI reports usage and read failures on stderr", () => {
    let help = runCli(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: lint_goal\.ts \[-h\] \[--json\] \[--strict\]/);

    let bogus = runCli(["--bogus"]);
    assert.equal(bogus.status, 2);
    assert.equal(bogus.stdout, "");
    assert.match(bogus.stderr, /lint_goal\.ts: error: unrecognized arguments: --bogus/);

    let inverted = runCli(["--max-chars", "100", "--target-chars", "900"]);
    assert.equal(inverted.status, 2);
    assert.match(inverted.stderr, /error: --target-chars cannot exceed --max-chars/);

    let nonPositive = runCli(["--max-chars", "0"]);
    assert.equal(nonPositive.status, 2);
    assert.match(nonPositive.stderr, /error: character limits must be positive/);

    let missing = runCli([path.join(tmpdir(), "lint-goal-does-not-exist.txt")]);
    assert.equal(missing.status, 2);
    assert.match(
        missing.stderr,
        /^error: Could not read .*: \[Errno 2\] No such file or directory: /,
    );
});
