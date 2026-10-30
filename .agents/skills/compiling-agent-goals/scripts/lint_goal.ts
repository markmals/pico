#!/usr/bin/env bun
/**
 * Heuristic structural linter for persistent coding-agent goal contracts.
 *
 * The linter checks the cross-harness contract emitted by the compiling-agent-goals skill.
 * It does not decide whether acceptance criteria are semantically correct; a model or
 * human must still perform the semantic review described in SKILL.md.
 */

import { readFileSync } from "node:fs";

export let DEFAULT_MAX_CHARS = 4000;
export let DEFAULT_TARGET_CHARS = 3000;

export type Severity = "error" | "warning";

export type Diagnostic = {
    severity: Severity;
    code: string;
    message: string;
};

export type LintResult = {
    source: string;
    characters: number;
    maxCharacters: number;
    targetCharacters: number;
    acceptanceCriteria: string[];
    diagnostics: Diagnostic[];
};

export type LintOptions = {
    source?: string;
    maxCharacters?: number;
    targetCharacters?: number;
};

export function errorsOf(result: LintResult): Diagnostic[] {
    return result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
}

export function warningsOf(result: LintResult): Diagnostic[] {
    return result.diagnostics.filter(diagnostic => diagnostic.severity === "warning");
}

let FENCE_RE = /^\s*```(?:text|markdown|md)?[ \t]*\n([\s\S]*)\n```\s*$/i;
let GOAL_LINE_RE = /^[ \t]*\/goal(?:[ \t]+(.*))?[ \t]*$/i;
let AC_LINE_RE = /^[ \t]*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(AC\d+)\s*[:.)\-]/gim;

// Callers often paste the generated footer back in; it is commentary, not goal body.
let COUNT_FOOTER_RE = /\n?[ \t]*Characters\s*:\s*\d[\d,]*\s*\/\s*4,?000[ \t]*$/i;

let DONE_HEADING_RE =
    /^\s*(?:#{1,6}\s+)?(?:Done when|Acceptance criteria|Completion criteria)\s*:/im;
let EVIDENCE_SECTION_RE = /^\s*(?:#{1,6}\s+)?(?:Evidence|Proof)\s*:/im;
let CRITERION_PROOF_RE = /\b(?:Proof|Evidence)\s*:/i;
let SUCCESS_EXIT_RE = /^\s*(?:[-*+]\s*)?(?:SUCCESS)\s*:/im;
let BLOCKED_EXIT_RE = /^\s*(?:[-*+]\s*)?(?:BLOCKED)\s*:/im;
let TURN_CAP_RE = /\b(\d{1,3})\s+(?:evaluated\s+|goal\s+)?turns?\b/gi;
let DOCUMENT_REFERENCE_RE = /(?:\b(?:spec|plan|design|requirements?)\b|[\w./-]+\.md\b)/i;

let SCOPE_RES = [/^\s*(?:#{1,6}\s+)?Scope\s*:/im, /^\s*-?\s*In\s*:/im];
let OUT_OF_SCOPE_RES = [/^\s*-?\s*Out\s*:/im, /\bout of scope\b/im, /\bnon-goals?\b/im];
let BASELINE_RES = [
    /\bbaseline\b/im,
    /\bpre[- ]existing\b/im,
    /\bintroduced or worsened\b/im,
    /\bnew regressions?\b/im,
];
let SUCCESS_STOPS_RES = [
    /\bstop immediately\b/im,
    /\bstop\b[^\n]{0,80}\bSUCCESS\b/im,
    /\bSUCCESS\b[^\n]{0,120}\bstop\b/im,
];
let NO_PROGRESS_RES = [
    /\bno[- ]progress\b/im,
    /\bno new evidence\b/im,
    /\bconsecutive\b[^\n]{0,80}\bturns?\b/im,
];
let FROZEN_CLOSURE_RES = [
    /\bdo not add\b[^\n]{0,80}\b(?:criteria|completion)\b/im,
    /\bonly\s+AC\d+/im,
    /\bonly the (?:fixed |finite )?(?:acceptance |completion )?criteria\b/im,
    /\bclosure set\b[^\n]{0,80}\b(?:fixed|frozen)\b/im,
];
let EVIDENCE_SURFACED_RES = [
    /\bsurface\b[^\n]{0,100}\b(?:evidence|command|result|exit status|measurement)\b/im,
    /\btranscript\b/im,
    /\bfinal turn\b[^\n]{0,120}\b(?:evidence|commands?|results?)\b/im,
];

type CodedPattern = {
    code: string;
    pattern: RegExp;
    message: string;
};

let UNBOUNDED_ERROR_PATTERNS: CodedPattern[] = [
    {
        code: "POINTER_ONLY_COMPLETION",
        pattern:
            /\b(?:implement|complete|finish|execute|follow)\s+(?:everything|all|the entirety)\s+(?:in|from|described in)\s+[^\n]*(?:spec|plan|design|requirements?|\.md)/i,
        message:
            "A source document is being used as an unbounded definition of done. Keep it as context and enumerate the finite closure set inline.",
    },
    {
        code: "DYNAMIC_SCOPE_TAIL",
        pattern:
            /\b(?:anything else|everything else|all (?:other )?issues|any (?:other )?issues|all work|all tasks)\s+(?:found|discovered|required|needed|remaining)\b/i,
        message: "The goal contains a mutable tail that can add work after execution starts.",
    },
    {
        code: "NO_POSSIBLE_IMPROVEMENTS",
        pattern:
            /\b(?:until|when)\s+(?:no|zero)\s+(?:further\s+)?(?:improvements?|issues?|problems?|warnings?|todos?|work)\s+(?:remain|are left|can be found)\b/i,
        message:
            "The stop condition asks the agent to prove an open world has no remaining improvements or issues.",
    },
    {
        code: "PERPETUAL_POLISH",
        pattern:
            /\bkeep\s+(?:iterating|improving|polishing|refining)\b(?![^\n]{0,120}\buntil\b[^\n]{0,80}\b\d+(?:\.\d+)?%?)/i,
        message: "Unbounded iteration needs a measurable threshold or a finite experiment budget.",
    },
];

let VAGUE_PATTERNS: CodedPattern[] = [
    {
        code: "VAGUE_PRODUCTION_READY",
        pattern: /\bproduction[- ]ready\b/i,
        message: "Replace 'production-ready' with the exact release gates that matter.",
    },
    {
        code: "VAGUE_QUALITY",
        pattern:
            /\b(?:best possible|perfect|fully polished|high quality|robust and clean|comprehensive)\b/i,
        message: "A subjective quality phrase needs a bounded rubric or measurable proxy.",
    },
    {
        code: "OPEN_EDGE_CASES",
        pattern: /\b(?:all|every) edge cases?\b/i,
        message:
            "Name the required edge-case set or fixture corpus instead of quantifying an open set.",
    },
    {
        code: "AS_NEEDED",
        pattern: /\bas needed\b/i,
        message: "'As needed' can expand scope; replace it with a named condition or remove it.",
    },
    {
        code: "DYNAMIC_BACKLOG",
        pattern:
            /\b(?:all (?:currently )?open (?:issues?|bugs?|prs?|pull requests?|tasks?)|(?:issue|bug|pr|task|work) queue (?:is |becomes )?empty)\b/i,
        message:
            "Freeze mutable queue membership by IDs, timestamp, or immutable snapshot so new items cannot extend the goal.",
    },
];

let PLACEHOLDER_PATTERNS: RegExp[] = [
    /\[(?:\.\.\.|TODO|TBD|NEEDS INPUT|One concrete outcome|literal paths|bounded files|Binary observable result)/i,
    /<\s*(?:TODO|TBD|insert|fill|path|command|threshold)[^>]*>/i,
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Python's len() counts code points; JavaScript's .length counts UTF-16 units, so an
// astral character would otherwise be billed twice against the character budget.
export function countCharacters(text: string): number {
    let count = 0;
    for (let _character of text) count += 1;
    return count;
}

export function normalizeText(text: string): string {
    let withoutBom = text.startsWith("\ufeff") ? text.replace(/^\ufeff+/, "") : text;
    return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Extract a single goal body from a raw body, fenced block, or /goal block. */
export function extractGoalBody(text: string): { body: string; diagnostics: Diagnostic[] } {
    let diagnostics: Diagnostic[] = [];
    let normalized = normalizeText(text).trim();

    let fenceMatch = normalized.match(FENCE_RE);
    if (fenceMatch) {
        normalized = fenceMatch[1].trim();
    }

    let lines = normalized.split("\n");
    let goalIndexes: number[] = [];
    let inlineValues = new Map<number, string>();
    for (let index = 0; index < lines.length; index += 1) {
        let match = lines[index].match(GOAL_LINE_RE);
        if (match) {
            goalIndexes.push(index);
            inlineValues.set(index, (match[1] ?? "").trim());
        }
    }

    if (goalIndexes.length > 1) {
        diagnostics.push({
            severity: "error",
            code: "MULTIPLE_GOALS",
            message: "Input contains more than one /goal command. Lint one goal body at a time.",
        });
        return { body: normalized, diagnostics };
    }

    if (goalIndexes.length === 1) {
        let index = goalIndexes[0];
        let bodyLines: string[] = [];
        let inline = inlineValues.get(index) ?? "";
        if (inline) bodyLines.push(inline);
        for (let rest = index + 1; rest < lines.length; rest += 1) bodyLines.push(lines[rest]);
        normalized = bodyLines.join("\n").trim();
    }

    // Be forgiving when the caller copied the generated character-count footer.
    normalized = normalized.replace(COUNT_FOOTER_RE, "").trim();

    return { body: normalized, diagnostics };
}

export function sectionCount(body: string, names: string[]): number {
    let alternatives = names.map(escapeRegExp).join("|");
    let pattern = new RegExp(`^[ \\t]*(?:#{1,6}[ \\t]+)?(?:${alternatives})\\s*:`, "gim");
    let count = 0;
    while (pattern.exec(body) !== null) count += 1;
    return count;
}

function hasAny(body: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(body));
}

export function acceptanceCriterionIds(body: string): string[] {
    let ids: string[] = [];
    for (let match of body.matchAll(AC_LINE_RE)) ids.push(match[1].toUpperCase());
    return ids;
}

function criterionBlocks(body: string): Map<string, string> {
    let matches = [...body.matchAll(AC_LINE_RE)];
    let blocks = new Map<string, string>();
    for (let index = 0; index < matches.length; index += 1) {
        let start = matches[index].index;
        let end = index + 1 < matches.length ? matches[index + 1].index : body.length;
        blocks.set(matches[index][1].toUpperCase(), body.slice(start, end));
    }
    return blocks;
}

export function lintGoal(rawText: string, options: LintOptions = {}): LintResult {
    let source = options.source ?? "<memory>";
    let maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARS;
    let targetCharacters = options.targetCharacters ?? DEFAULT_TARGET_CHARS;

    let extraction = extractGoalBody(rawText);
    let body = extraction.body;
    let diagnostics: Diagnostic[] = extraction.diagnostics;
    let characters = countCharacters(body);

    if (!body) {
        diagnostics.push({ severity: "error", code: "EMPTY_GOAL", message: "Goal body is empty." });
        return {
            source,
            characters: 0,
            maxCharacters,
            targetCharacters,
            acceptanceCriteria: [],
            diagnostics,
        };
    }

    if (characters > maxCharacters) {
        diagnostics.push({
            severity: "error",
            code: "OVER_HARD_LIMIT",
            message: `Goal body is ${characters} characters; the hard limit is ${maxCharacters}.`,
        });
    } else if (characters > targetCharacters) {
        diagnostics.push({
            severity: "warning",
            code: "OVER_TARGET_LIMIT",
            message: `Goal body is ${characters} characters; target ${targetCharacters} or fewer to preserve clarity and edit headroom.`,
        });
    }

    let objectiveCount = sectionCount(body, ["Objective"]);
    if (objectiveCount === 0) {
        diagnostics.push({
            severity: "error",
            code: "MISSING_OBJECTIVE",
            message: "Add one 'Objective:' end-state statement.",
        });
    } else if (objectiveCount > 1) {
        diagnostics.push({
            severity: "error",
            code: "MULTIPLE_OBJECTIVES",
            message:
                "More than one 'Objective:' section was found. Split independent outcomes into a goal pack.",
        });
    }

    let acIds = acceptanceCriterionIds(body);
    let uniqueAcIds = [...new Set(acIds)];
    if (uniqueAcIds.length === 0) {
        diagnostics.push({
            severity: "error",
            code: "MISSING_ACCEPTANCE_CRITERIA",
            message: "Add fixed, ID-labeled acceptance criteria (AC1, AC2, ...).",
        });
    } else {
        let duplicates = uniqueAcIds
            .filter(id => acIds.filter(candidate => candidate === id).length > 1)
            .sort();
        if (duplicates.length > 0) {
            diagnostics.push({
                severity: "error",
                code: "DUPLICATE_AC_IDS",
                message: `Acceptance-criterion IDs must be unique; duplicated: ${duplicates.join(", ")}.`,
            });
        }
        if (uniqueAcIds.length > 8) {
            diagnostics.push({
                severity: "warning",
                code: "TOO_MANY_ACCEPTANCE_CRITERIA",
                message: `Found ${uniqueAcIds.length} criteria. More than 8 usually indicates that the work should be split into a goal pack.`,
            });
        }

        let sequential = uniqueAcIds.every(
            (id, index) => Number.parseInt(id.slice(2), 10) === index + 1,
        );
        if (!sequential) {
            diagnostics.push({
                severity: "warning",
                code: "NONSEQUENTIAL_AC_IDS",
                message: `Use stable sequential IDs starting at AC1; found ${uniqueAcIds.join(", ")}.`,
            });
        }
    }

    if (!DONE_HEADING_RE.test(body)) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_DONE_HEADING",
            message:
                "Group the fixed criteria under 'Done when:' or an equivalent explicit closure heading.",
        });
    }

    let blocks = criterionBlocks(body);
    let hasEvidenceSection = EVIDENCE_SECTION_RE.test(body);
    let missingProof: string[] = [];
    for (let [acId, block] of blocks) {
        if (CRITERION_PROOF_RE.test(block)) continue;
        if (
            hasEvidenceSection &&
            new RegExp(`(?:Evidence|Proof)\\s*:[\\s\\S]*\\b${escapeRegExp(acId)}\\b`, "i").test(
                body,
            )
        ) {
            continue;
        }
        missingProof.push(acId);
    }
    if (uniqueAcIds.length > 0 && missingProof.length === uniqueAcIds.length) {
        diagnostics.push({
            severity: "error",
            code: "MISSING_EVIDENCE_MAP",
            message:
                "No acceptance criterion is bound to explicit proof. Add exact commands, measurements, artifacts, or bounded inspections.",
        });
    } else if (missingProof.length > 0) {
        diagnostics.push({
            severity: "warning",
            code: "PARTIAL_EVIDENCE_MAP",
            message: `These criteria lack an explicit proof mapping: ${missingProof.join(", ")}.`,
        });
    }

    if (!hasAny(body, SCOPE_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_SCOPE",
            message: "Add an explicit in-scope boundary.",
        });
    }
    if (!hasAny(body, OUT_OF_SCOPE_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_OUT_OF_SCOPE",
            message: "Name adjacent work that must not expand the goal.",
        });
    }

    if (!hasAny(body, BASELINE_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_BASELINE_POLICY",
            message: "State how pre-existing failures and regressions affect completion.",
        });
    }

    if (!SUCCESS_EXIT_RE.test(body)) {
        diagnostics.push({
            severity: "error",
            code: "MISSING_SUCCESS_EXIT",
            message: "Add a separately labeled 'SUCCESS:' terminal outcome.",
        });
    }
    if (!BLOCKED_EXIT_RE.test(body)) {
        diagnostics.push({
            severity: "error",
            code: "MISSING_BLOCKED_EXIT",
            message: "Add a separately labeled 'BLOCKED:' terminal outcome.",
        });
    }

    if (!hasAny(body, SUCCESS_STOPS_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "SUCCESS_DOES_NOT_STOP",
            message:
                "Tell the worker to stop immediately after SUCCESS so optional polishing cannot extend the loop.",
        });
    }

    let hasNoProgress = hasAny(body, NO_PROGRESS_RES);
    let turnCaps: number[] = [];
    for (let match of body.matchAll(TURN_CAP_RE)) turnCaps.push(Number.parseInt(match[1], 10));
    if (!hasNoProgress) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_STAGNATION_EXIT",
            message: "Add a bounded no-progress clause to stop repeated thrashing.",
        });
    }
    if (turnCaps.length === 0) {
        diagnostics.push({
            severity: "warning",
            code: "MISSING_ABSOLUTE_CAP",
            message: "Add an absolute turn cap (typically 10, 20, or 30) to guarantee termination.",
        });
    } else if (Math.max(...turnCaps) > 30) {
        diagnostics.push({
            severity: "warning",
            code: "TURN_CAP_TOO_HIGH",
            message: `Found a ${Math.max(...turnCaps)}-turn cap. Split the task rather than assigning more than 30 turns to one goal.`,
        });
    }

    if (!hasAny(body, FROZEN_CLOSURE_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "MUTABLE_CLOSURE_NOT_FORBIDDEN",
            message:
                "State that acceptance criteria are fixed and optional discoveries become follow-ups.",
        });
    }

    if (!hasAny(body, EVIDENCE_SURFACED_RES)) {
        diagnostics.push({
            severity: "warning",
            code: "EVIDENCE_NOT_SURFACED",
            message:
                "Require decisive evidence in the final conversation turn; an external evaluator may not inspect files or run tools.",
        });
    }

    for (let { code, pattern, message } of UNBOUNDED_ERROR_PATTERNS) {
        if (pattern.test(body)) diagnostics.push({ severity: "error", code, message });
    }

    for (let { code, pattern, message } of VAGUE_PATTERNS) {
        if (pattern.test(body)) diagnostics.push({ severity: "warning", code, message });
    }

    for (let pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(body)) {
            diagnostics.push({
                severity: "error",
                code: "UNRESOLVED_PLACEHOLDER",
                message: "Goal contains an unresolved template placeholder.",
            });
            break;
        }
    }

    // A document reference is allowed, but not as the sole closure mechanism.
    let referencesDocument = DOCUMENT_REFERENCE_RE.test(body);
    if (referencesDocument && uniqueAcIds.length === 0) {
        diagnostics.push({
            severity: "error",
            code: "DOCUMENT_WITHOUT_INLINE_CLOSURE",
            message: "A referenced document must be paired with inline, fixed acceptance criteria.",
        });
    }

    // Keep diagnostics stable and avoid duplicate codes from overlapping checks.
    let deduplicated: Diagnostic[] = [];
    let seen = new Set<string>();
    for (let diagnostic of diagnostics) {
        let key = `${diagnostic.severity}\u0000${diagnostic.code}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduplicated.push(diagnostic);
        }
    }

    return {
        source,
        characters,
        maxCharacters,
        targetCharacters,
        acceptanceCriteria: uniqueAcIds,
        diagnostics: deduplicated,
    };
}

export function formatText(result: LintResult): string {
    let criteria = result.acceptanceCriteria;
    let lines = [
        `source: ${result.source}`,
        `characters: ${result.characters} / ${result.maxCharacters} (target <= ${result.targetCharacters})`,
        `acceptance criteria: ${criteria.length}` +
            (criteria.length > 0 ? ` (${criteria.join(", ")})` : ""),
        `errors: ${errorsOf(result).length}; warnings: ${warningsOf(result).length}`,
    ];
    for (let diagnostic of result.diagnostics) {
        lines.push(
            `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
        );
    }
    if (result.diagnostics.length === 0) {
        lines.push("OK: no structural issues found");
    }
    return lines.join("\n");
}

export function resultAsJson(result: LintResult): string {
    // Keys are emitted in sorted order, and non-ASCII is escaped, so the payload is
    // byte-identical to the json.dumps(sort_keys=True) output this script replaces.
    let payload = {
        acceptance_criteria: result.acceptanceCriteria,
        characters: result.characters,
        diagnostics: result.diagnostics.map(diagnostic => ({
            code: diagnostic.code,
            message: diagnostic.message,
            severity: diagnostic.severity,
        })),
        max_characters: result.maxCharacters,
        source: result.source,
        summary: { errors: errorsOf(result).length, warnings: warningsOf(result).length },
        target_characters: result.targetCharacters,
    };
    return JSON.stringify(payload, null, 2).replace(
        /[\u0080-\uffff]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

type SystemError = Error & { code?: string; errno?: number; syscall?: string };

// Mirrors the OSError text the Python implementation surfaced, because callers and
// harness logs match on it. Bun words the same failures differently.
let STRERROR: Record<string, string> = {
    ENOENT: "No such file or directory",
    EACCES: "Permission denied",
    EISDIR: "Is a directory",
    ENOTDIR: "Not a directory",
    ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long",
};

export function describeSystemError(error: SystemError, path: string): string {
    let code = error.code ?? "";
    let strerror = STRERROR[code];
    if (strerror === undefined) {
        let separator = error.message.indexOf(", ");
        let text = separator > 0 ? error.message.slice(code.length + 2, separator) : error.message;
        strerror = text.charAt(0).toUpperCase() + text.slice(1);
    }
    let number = error.errno === undefined ? 0 : Math.abs(error.errno);
    return `Could not read ${path}: [Errno ${number}] ${strerror}: '${path}'`;
}

export function readInput(pathValue: string): { rawText: string; source: string } {
    if (pathValue === "-") {
        return { rawText: readFileSync(0, "utf8"), source: "<stdin>" };
    }
    try {
        return { rawText: readFileSync(pathValue, "utf8"), source: pathValue };
    } catch (error) {
        throw new Error(describeSystemError(error as SystemError, pathValue));
    }
}

export let VALID_SELF_TEST_GOAL = [
    "/goal",
    "Objective: Make the parser reject duplicate IDs.",
    "Inputs: Read `SPEC.md` as context; only AC1 and AC2 define completion.",
    "Scope:",
    "- In: parser and parser tests",
    "- Out: formatter changes",
    "Done when:",
    "- AC1: Duplicate IDs return error E_DUP. Proof: `pytest tests/test_parser.py -k duplicate` exits 0.",
    "- AC2: Existing unique-ID fixtures still pass. Proof: `pytest tests/test_parser.py -k unique` exits 0.",
    "Baseline and regressions: Capture both tests before edits; new failures block and unrelated pre-existing failures do not.",
    "Execution rules: Do not add criteria; record optional discoveries as follow-ups. In the final turn, surface commands, exit status, and results.",
    "Terminal outcomes:",
    "- SUCCESS: AC1 and AC2 pass with surfaced evidence; stop immediately.",
    "- BLOCKED: Stop without claiming success after unavailable external input, 3 consecutive turns with no new evidence, or 10 turns; report state and smallest next action.",
    "",
].join("\n");

export function runSelfTest(): number {
    let validResult = lintGoal(VALID_SELF_TEST_GOAL);
    if (errorsOf(validResult).length > 0) {
        console.error("self-test failed: valid fixture produced errors");
        console.error(formatText(validResult));
        return 1;
    }

    let pointer =
        "/goal Implement everything in SPEC.md and keep improving until no issues remain.";
    let pointerResult = lintGoal(pointer);
    let pointerCodes = new Set(errorsOf(pointerResult).map(diagnostic => diagnostic.code));
    let required = [
        "MISSING_ACCEPTANCE_CRITERIA",
        "POINTER_ONLY_COMPLETION",
        "NO_POSSIBLE_IMPROVEMENTS",
    ];
    if (!required.every(code => pointerCodes.has(code))) {
        console.error("self-test failed: pointer fixture missed expected errors");
        console.error(formatText(pointerResult));
        return 1;
    }

    let oversized = VALID_SELF_TEST_GOAL + "x".repeat(4001);
    let oversizedResult = lintGoal(oversized);
    if (!errorsOf(oversizedResult).some(diagnostic => diagnostic.code === "OVER_HARD_LIMIT")) {
        console.error("self-test failed: oversized fixture was not rejected");
        return 1;
    }

    console.log("self-test: OK");
    return 0;
}

export type Arguments = {
    path: string;
    json: boolean;
    strict: boolean;
    maxChars: number;
    targetChars: number;
    selfTest: boolean;
};

export class UsageError extends Error {}

let PROGRAM = "lint_goal.ts";

let USAGE = [
    `usage: ${PROGRAM} [-h] [--json] [--strict] [--max-chars MAX_CHARS]`,
    `${" ".repeat("usage: ".length + PROGRAM.length + 1)}[--target-chars TARGET_CHARS] [--self-test]`,
    `${" ".repeat("usage: ".length + PROGRAM.length + 1)}[path]`,
].join("\n");

let HELP = [
    USAGE,
    "",
    "Heuristically lint a persistent agent goal contract.",
    "",
    "positional arguments:",
    "  path                  Goal file to lint, or '-' for stdin (default).",
    "",
    "options:",
    "  -h, --help            show this help message and exit",
    "  --json                Emit machine-readable JSON.",
    "  --strict              Return a nonzero exit status when warnings are",
    "                        present.",
    "  --max-chars MAX_CHARS",
    `                        Hard character limit (default: ${DEFAULT_MAX_CHARS}).`,
    "  --target-chars TARGET_CHARS",
    `                        Preferred character target (default: ${DEFAULT_TARGET_CHARS}).`,
    "  --self-test           Run built-in fixtures and exit.",
].join("\n");

function parseInteger(flag: string, value: string): number {
    if (!/^[+-]?\d+$/.test(value.trim())) {
        throw new UsageError(`argument ${flag}: invalid int value: '${value}'`);
    }
    return Number.parseInt(value.trim(), 10);
}

/** Throws UsageError for anything argparse would reject; returns null for --help. */
export function parseArguments(argv: string[]): Arguments | null {
    let parsed: Arguments = {
        path: "-",
        json: false,
        strict: false,
        maxChars: DEFAULT_MAX_CHARS,
        targetChars: DEFAULT_TARGET_CHARS,
        selfTest: false,
    };
    let positionals: string[] = [];
    let unrecognized: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        let argument = argv[index];
        let separator = argument.indexOf("=");
        let flag =
            argument.startsWith("--") && separator > 0 ? argument.slice(0, separator) : argument;
        let attached =
            argument.startsWith("--") && separator > 0 ? argument.slice(separator + 1) : null;

        let valueFor = (): string => {
            if (attached !== null) return attached;
            index += 1;
            if (index >= argv.length) {
                throw new UsageError(`argument ${flag}: expected one argument`);
            }
            return argv[index];
        };

        switch (flag) {
            case "-h":
            case "--help":
                return null;
            case "--json":
                parsed.json = true;
                break;
            case "--strict":
                parsed.strict = true;
                break;
            case "--self-test":
                parsed.selfTest = true;
                break;
            case "--max-chars":
                parsed.maxChars = parseInteger(flag, valueFor());
                break;
            case "--target-chars":
                parsed.targetChars = parseInteger(flag, valueFor());
                break;
            default:
                if (argument.startsWith("-") && argument !== "-") unrecognized.push(argument);
                else positionals.push(argument);
        }
    }

    if (positionals.length > 1) unrecognized.push(...positionals.slice(1));
    if (unrecognized.length > 0) {
        throw new UsageError(`unrecognized arguments: ${unrecognized.join(" ")}`);
    }
    if (positionals.length === 1) parsed.path = positionals[0];

    return parsed;
}

function usageError(message: string): number {
    console.error(USAGE);
    console.error(`${PROGRAM}: error: ${message}`);
    return 2;
}

export function main(argv: string[]): number {
    let parsed: Arguments | null;
    try {
        parsed = parseArguments(argv);
    } catch (error) {
        return usageError((error as Error).message);
    }
    if (parsed === null) {
        console.log(HELP);
        return 0;
    }

    if (parsed.selfTest) return runSelfTest();
    if (parsed.maxChars <= 0 || parsed.targetChars <= 0) {
        return usageError("character limits must be positive");
    }
    if (parsed.targetChars > parsed.maxChars) {
        return usageError("--target-chars cannot exceed --max-chars");
    }

    let input: { rawText: string; source: string };
    try {
        input = readInput(parsed.path);
    } catch (error) {
        console.error(`error: ${(error as Error).message}`);
        return 2;
    }

    let result = lintGoal(input.rawText, {
        source: input.source,
        maxCharacters: parsed.maxChars,
        targetCharacters: parsed.targetChars,
    });
    console.log(parsed.json ? resultAsJson(result) : formatText(result));

    if (errorsOf(result).length > 0) return 2;
    if (parsed.strict && warningsOf(result).length > 0) return 1;
    return 0;
}

// process.exitCode rather than process.exit(), so a piped --json payload is flushed in full.
if (import.meta.main) {
    process.exitCode = main(process.argv.slice(2));
}
