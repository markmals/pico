#!/usr/bin/env bun
/**
 * Lightweight technical-writing linter.
 *
 * This script is intentionally conservative. It reports review hints for Markdown
 * and Swift documentation prose; it does not decide whether a document is correct.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { getSystemErrorMap } from "node:util";

export type Rule = {
    code: string;
    pattern: RegExp;
    message: string;
};

export type Finding = {
    path: string;
    lineNumber: number;
    code: string;
    message: string;
    text: string;
};

export let TEXT_EXTENSIONS: Record<string, true> = {
    ".md": true,
    ".mdx": true,
    ".markdown": true,
    ".swift": true,
};
export let SKIP_DIRS: Record<string, true> = {
    ".build": true,
    ".git": true,
    ".swiftpm": true,
    Build: true,
    DerivedData: true,
    Pods: true,
    Carthage: true,
    node_modules: true,
};

/**
 * Characters Python's `str.isspace()` accepts. JavaScript's `\s` and `String.trim`
 * disagree at both ends: they omit the file/group separators `\x1c-\x1f` and `\x85`,
 * and they add `\ufeff`. Trimming decides which lines look like fences, tables, or
 * shebangs, so the linter carries its own class instead of inheriting that drift.
 */
let PY_SPACE =
    "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
let LEADING_SPACE_RE = new RegExp(`^[${PY_SPACE}]+`, "u");
let TRAILING_SPACE_RE = new RegExp(`[${PY_SPACE}]+$`, "u");
let ANY_SPACE_RE = new RegExp(`[${PY_SPACE}]`, "u");

/**
 * Python's `\b` is Unicode aware; JavaScript's `\b` is defined over ASCII `\w` only,
 * so `\bjust\b` would fire inside a word that starts with a non-ASCII letter. The
 * ported patterns spell the boundary out with property-escape lookarounds instead.
 */
let WORD_START = "(?<![\\p{L}\\p{N}_])";
let WORD_END = "(?![\\p{L}\\p{N}_])";

let CALLOUT_RE = new RegExp(
    `^[${PY_SPACE}]*>[${PY_SPACE}]*\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\]`,
    "u",
);
let CODE_SPAN_RE = /`[^`]*`/gu;
let FENCE_RE = /^(`{3,})(.*)$/u;
let SWIFT_DOC_SLASH_RE = new RegExp(`^[${PY_SPACE}]*/// ?`, "u");
let SWIFT_DOC_STAR_RE = new RegExp(`^[${PY_SPACE}]*/?\\*+ ?`, "u");

let CODE_LINE_PREFIXES = [
    "import ",
    "let ",
    "var ",
    "func ",
    "class ",
    "struct ",
    "enum ",
    "protocol ",
    "extension ",
    "@",
];

function words(source: string): RegExp {
    return new RegExp(`${WORD_START}(?:${source})${WORD_END}`, "iu");
}

export let PATTERNS: Rule[] = [
    {
        code: "filler",
        pattern: words("just|simply|basically|essentially|obviously|clearly"),
        message: "Remove filler unless it changes the technical meaning.",
    },
    {
        code: "chatbot",
        pattern: words("Sure|Certainly|Great|Awesome|Let me|I'll|Here(?:'s| is)|Let's dive in"),
        message: "Remove chatbot scaffolding from the artifact.",
    },
    {
        code: "word-choice",
        pattern: words("utili[sz]e(?:s|d|ing)?"),
        message: "Prefer 'use' unless a project term requires this word.",
    },
    {
        code: "vague-leverage",
        pattern: words("leverage(?:s|d|ing)?"),
        message: "Replace 'leverage' with a more precise verb.",
    },
    {
        code: "marketing",
        pattern: words("seamless|robust|powerful|easy|straightforward"),
        message: "Prove this claim or replace it with the concrete behavior.",
    },
    {
        code: "overqualified",
        pattern: words(
            "it should be noted that|it is important to note that|as previously mentioned",
        ),
        message: "Make the point directly or delete it.",
    },
    {
        code: "hedge",
        pattern: words("could potentially|may or may not|might possibly"),
        message: "State the condition or uncertainty directly.",
    },
];

export function pyStrip(value: string): string {
    return value.replace(LEADING_SPACE_RE, "").replace(TRAILING_SPACE_RE, "");
}

export function pyLStrip(value: string): string {
    return value.replace(LEADING_SPACE_RE, "");
}

/** Mirrors `PurePath.suffix`: the text from the last dot, unless that dot starts the name. */
export function suffixOf(filePath: string): string {
    let name = filePath.slice(filePath.lastIndexOf("/") + 1);
    let index = name.lastIndexOf(".");
    return index > 0 ? name.slice(index) : "";
}

/** Mirrors `str(Path(value))`: drop `.` and empty segments, keep `..`, keep a leading `//`. */
export function normalizePath(value: string): string {
    let root = "";
    if (value.startsWith("//") && !value.startsWith("///")) {
        root = "//";
    } else if (value.startsWith("/")) {
        root = "/";
    }
    let parts = value.split("/").filter(part => part !== "" && part !== ".");
    if (parts.length === 0) {
        return root === "" ? "." : root;
    }
    return root + parts.join("/");
}

function pathParts(filePath: string): string[] {
    let root =
        filePath.startsWith("//") && !filePath.startsWith("///")
            ? "//"
            : filePath.startsWith("/")
              ? "/"
              : "";
    let parts = filePath.split("/").filter(part => part !== "");
    return root === "" ? parts : [root, ...parts];
}

/** Mirrors `sorted()` over `Path` objects, which compares path components, not whole strings. */
export function comparePaths(left: string, right: string): number {
    let leftParts = pathParts(left);
    let rightParts = pathParts(right);
    for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
        if (leftParts[index] < rightParts[index]) {
            return -1;
        }
        if (leftParts[index] > rightParts[index]) {
            return 1;
        }
    }
    return leftParts.length - rightParts.length;
}

/** Mirrors `Path.relative_to(Path.cwd())`, which strips whole components or raises. */
export function displayPath(filePath: string, cwd: string): string {
    let prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
    if (filePath.startsWith(prefix) && filePath.length > prefix.length) {
        return filePath.slice(prefix.length);
    }
    return filePath;
}

/** Mirrors `repr()` for the short, whitespace-free strings this script quotes. */
function pyRepr(value: string): string {
    let quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let body = "";
    for (let character of value) {
        if (character === "\\" || character === quote) {
            body += `\\${character}`;
        } else if (character === "\n") {
            body += "\\n";
        } else if (character === "\r") {
            body += "\\r";
        } else if (character === "\t") {
            body += "\\t";
        } else {
            let code = character.codePointAt(0) ?? 0;
            body +=
                code < 0x20 || code === 0x7f
                    ? `\\x${code.toString(16).padStart(2, "0")}`
                    : character;
        }
    }
    return quote + body + quote;
}

/**
 * Compile a rule pattern written for Python's `re`.
 *
 * Two Python spellings have no JavaScript equivalent and are rewritten so existing
 * rule files keep working: a leading inline flag group such as `(?i)`, which Python
 * requires at the start of the expression, and named groups `(?P<name>…)` /
 * backreferences `(?P=name)`. Everything else is handed to `RegExp` unchanged.
 */
export function compilePattern(source: string): RegExp {
    let flags = "";
    let rest = source;
    let inlineFlags = /^\(\?([aiLmsux]+)\)/;
    let match = inlineFlags.exec(rest);
    while (match !== null) {
        for (let flag of match[1]) {
            if (flag === "x") {
                throw new Error("verbose patterns ((?x)) are not supported");
            }
            // "a", "L", and "u" select the character-class semantics that this engine
            // already uses for rule patterns, so they carry no flag of their own.
            if ((flag === "i" || flag === "m" || flag === "s") && !flags.includes(flag)) {
                flags += flag;
            }
        }
        rest = rest.slice(match[0].length);
        match = inlineFlags.exec(rest);
    }

    let translated = "";
    let index = 0;
    let inClass = false;
    while (index < rest.length) {
        let character = rest[index];
        if (character === "\\") {
            translated += rest.slice(index, index + 2);
            index += 2;
            continue;
        }
        if (inClass) {
            inClass = character !== "]";
            translated += character;
            index += 1;
            continue;
        }
        if (character === "[") {
            inClass = true;
            translated += character;
            index += 1;
            continue;
        }
        if (rest.startsWith("(?P<", index)) {
            translated += "(?<";
            index += 4;
            continue;
        }
        if (rest.startsWith("(?P=", index)) {
            let end = rest.indexOf(")", index + 4);
            if (end !== -1) {
                translated += `\\k<${rest.slice(index + 4, end)}>`;
                index = end + 1;
                continue;
            }
        }
        translated += character;
        index += 1;
    }

    return new RegExp(translated, flags);
}

/** Load additional rules without changing the built-in defaults. */
export function loadRules(text: string): Rule[] {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`invalid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(data)) {
        throw new Error("expected a JSON list of rule objects");
    }

    let codes = new Set(PATTERNS.map(rule => rule.code));
    codes.add("exclamation");
    codes.add("code-fence-language");

    let rules: Rule[] = [];
    for (let index = 1; index <= data.length; index += 1) {
        let rule = data[index - 1] as Record<string, unknown>;
        let keys =
            rule !== null && typeof rule === "object" && !Array.isArray(rule)
                ? Object.keys(rule).sort()
                : null;
        if (
            keys === null ||
            keys.length !== 3 ||
            keys[0] !== "code" ||
            keys[1] !== "message" ||
            keys[2] !== "pattern"
        ) {
            throw new Error(`rule ${index}: expected an object with code, pattern, and message`);
        }
        for (let field of ["code", "pattern", "message"]) {
            if (typeof rule[field] !== "string" || pyStrip(rule[field] as string) === "") {
                throw new Error(`rule ${index}: ${field} must be a nonempty string`);
            }
        }
        let code = rule.code as string;
        if (code !== pyStrip(code) || ANY_SPACE_RE.test(code)) {
            throw new Error(`rule ${index}: code must not contain whitespace`);
        }
        if (codes.has(code)) {
            throw new Error(`rule ${index}: duplicate or reserved code ${pyRepr(code)}`);
        }
        let pattern: RegExp;
        try {
            pattern = compilePattern(rule.pattern as string);
        } catch (error) {
            throw new Error(
                `rule ${index} (${code}): invalid pattern: ${(error as Error).message}`,
            );
        }
        codes.add(code);
        rules.push({ code, pattern, message: rule.message as string });
    }
    return rules;
}

export function iterFiles(paths: Iterable<string>): string[] {
    let found: string[] = [];
    for (let path of paths) {
        let stats = statOrNull(path);
        if (stats === null) {
            continue;
        }
        if (stats.isFile()) {
            if (TEXT_EXTENSIONS[suffixOf(path)] === true) {
                found.push(path);
            }
            continue;
        }
        if (!stats.isDirectory()) {
            continue;
        }
        walk(path, found);
    }
    return found;
}

function statOrNull(path: string) {
    try {
        return statSync(path);
    } catch {
        return null;
    }
}

function walk(root: string, found: string[]): void {
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    let directories: string[] = [];
    for (let entry of entries) {
        // `Path(root) / name` drops a lone "." root, so `lint .` reports "a.md", not "./a.md".
        let candidate =
            root === "." ? entry.name : root === "/" ? `/${entry.name}` : `${root}/${entry.name}`;
        // `os.walk` classifies entries by following symlinks but never descends into
        // a symlinked directory while `followlinks` is false.
        let stats = statOrNull(candidate);
        if (stats !== null && stats.isDirectory()) {
            if (SKIP_DIRS[entry.name] !== true && !entry.isSymbolicLink()) {
                directories.push(candidate);
            }
            continue;
        }
        if (TEXT_EXTENSIONS[suffixOf(candidate)] === true) {
            found.push(candidate);
        }
    }
    for (let directory of directories) {
        walk(directory, found);
    }
}

export function isProbablyCodeLine(line: string, inFence: boolean, suffix: string): boolean {
    let stripped = pyStrip(line);
    if (inFence) {
        return true;
    }
    if (
        suffix === ".swift" &&
        !stripped.startsWith("///") &&
        !stripped.startsWith("/**") &&
        !stripped.startsWith("*")
    ) {
        return true;
    }
    return CODE_LINE_PREFIXES.some(prefix => stripped.startsWith(prefix));
}

/** Mirrors `str.splitlines()` on text read with Python's universal-newline translation. */
export function splitLines(text: string): string[] {
    let lines = text.replace(/\r\n|\r/gu, "\n").split(/[\n\v\f\x1c-\x1e\x85\u2028\u2029]/u);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

export function lintLines(
    lines: string[],
    suffix: string,
    extraPatterns: Iterable<Rule> = [],
): Omit<Finding, "path">[] {
    let findings: Omit<Finding, "path">[] = [];
    let inFence = false;
    let fenceMarker = "";
    let patterns = [...PATTERNS, ...extraPatterns];
    let isMarkdown = suffix === ".md" || suffix === ".mdx" || suffix === ".markdown";

    for (let index = 1; index <= lines.length; index += 1) {
        let line = lines[index - 1];
        let stripped = pyStrip(line);

        if (isMarkdown) {
            let match = FENCE_RE.exec(stripped);
            if (match !== null && !inFence) {
                fenceMarker = match[1];
                if (pyStrip(match[2]) === "") {
                    findings.push({
                        lineNumber: index,
                        code: "code-fence-language",
                        message: "Add a language hint to the fenced code block.",
                        text: line,
                    });
                }
                inFence = true;
                continue;
            }
            if (
                match !== null &&
                inFence &&
                match[1].length >= fenceMarker.length &&
                pyStrip(match[2]) === ""
            ) {
                inFence = false;
                fenceMarker = "";
                continue;
            }
        }

        if (isProbablyCodeLine(line, inFence, suffix)) {
            continue;
        }

        let prose = line.replace(CODE_SPAN_RE, "");
        if (pyLStrip(prose).startsWith("|")) {
            continue;
        }
        if (suffix === ".swift") {
            prose = prose.replace(SWIFT_DOC_SLASH_RE, "");
            prose = prose.replace(SWIFT_DOC_STAR_RE, "");
        }

        let exclamationProse = prose.replace(CALLOUT_RE, "");
        if (
            exclamationProse.includes("!") &&
            !stripped.startsWith("#!") &&
            !stripped.startsWith("<!--")
        ) {
            findings.push({
                lineNumber: index,
                code: "exclamation",
                message:
                    "Avoid exclamation points in technical prose unless they are part of code or required syntax.",
                text: line,
            });
        }

        for (let rule of patterns) {
            if (rule.pattern.test(prose)) {
                findings.push({
                    lineNumber: index,
                    code: rule.code,
                    message: rule.message,
                    text: line,
                });
            }
        }
    }

    return findings;
}

/**
 * Reads UTF-8 strictly. Python raises UnicodeDecodeError on invalid input, while a
 * default TextDecoder would silently substitute U+FFFD and lint the damaged text.
 */
function readTextFile(path: string): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}

export function lintFile(path: string, extraPatterns: Iterable<Rule> = []): Finding[] {
    let text: string;
    try {
        text = readTextFile(path);
    } catch (error) {
        if (error instanceof TypeError) {
            return [];
        }
        throw error;
    }
    return lintLines(splitLines(text), suffixOf(path), extraPatterns).map(finding => ({
        path,
        ...finding,
    }));
}

export function formatFinding(finding: Finding, cwd: string): string {
    return `${displayPath(finding.path, cwd)}:${finding.lineNumber}: ${finding.code}: ${finding.message}\n  ${pyStrip(finding.text)}`;
}

export type Arguments = {
    paths: string[];
    failOnWarnings: boolean;
    rulesFile: string | null;
};

let PROG = basename(process.argv[1] ?? "lint_technical_writing.ts");
// argparse rewraps its usage line to the terminal width; this is its rendering at
// the 80-column default that applies whenever output is not a terminal.
let USAGE_INDENT = " ".repeat("usage: ".length + PROG.length + 1);
let USAGE = `usage: ${PROG} [-h] [--fail-on-warnings]
${USAGE_INDENT}[--rules-file RULES_FILE]
${USAGE_INDENT}paths [paths ...]`;
let HELP = `${USAGE}

Report technical-writing style warnings for Markdown and Swift docs.

positional arguments:
  paths                 Files or directories to lint.

options:
  -h, --help            show this help message and exit
  --fail-on-warnings    Exit with status 1 when warnings are found.
  --rules-file RULES_FILE
                        Append rules from a JSON list of code, pattern, and
                        message objects.`;

class ArgumentError extends Error {}

/** Mirrors the `argparse` parser this script was built with, including its diagnostics. */
export function parseArguments(argv: string[]): Arguments {
    let paths: string[] = [];
    let failOnWarnings = false;
    let rulesFile: string | null = null;
    let unrecognized: string[] = [];
    let positionalsOnly = false;

    for (let index = 0; index < argv.length; index += 1) {
        let argument = argv[index];
        if (positionalsOnly || argument === "-" || !argument.startsWith("-")) {
            paths.push(argument);
            continue;
        }
        if (argument === "--") {
            positionalsOnly = true;
            continue;
        }
        let separator = argument.indexOf("=");
        let name = separator === -1 ? argument : argument.slice(0, separator);
        let inlineValue = separator === -1 ? null : argument.slice(separator + 1);
        if (name === "-h" || name === "--help") {
            process.stdout.write(`${HELP}\n`);
            process.exit(0);
        }
        if (name === "--fail-on-warnings") {
            if (inlineValue !== null) {
                throw new ArgumentError(
                    `argument --fail-on-warnings: ignored explicit argument ${pyRepr(inlineValue)}`,
                );
            }
            failOnWarnings = true;
            continue;
        }
        if (name === "--rules-file") {
            if (inlineValue !== null) {
                rulesFile = inlineValue;
                continue;
            }
            let next = argv[index + 1];
            if (next === undefined || (next.startsWith("-") && next !== "-")) {
                throw new ArgumentError("argument --rules-file: expected one argument");
            }
            rulesFile = next;
            index += 1;
            continue;
        }
        unrecognized.push(argument);
    }

    if (paths.length === 0) {
        throw new ArgumentError("the following arguments are required: paths");
    }
    if (unrecognized.length > 0) {
        throw new ArgumentError(`unrecognized arguments: ${unrecognized.join(" ")}`);
    }
    return {
        paths: paths.map(normalizePath),
        failOnWarnings,
        rulesFile: rulesFile === null ? null : normalizePath(rulesFile),
    };
}

export function main(argv: string[]): number {
    let args: Arguments;
    try {
        args = parseArguments(argv);
    } catch (error) {
        return argumentFailure((error as Error).message);
    }

    let extraPatterns: Rule[] = [];
    if (args.rulesFile !== null) {
        try {
            extraPatterns = loadRules(readTextFile(args.rulesFile));
        } catch (error) {
            return argumentFailure(
                `cannot load rules file ${args.rulesFile}: ${describeLoadFailure(error, args.rulesFile)}`,
            );
        }
    }

    let unique = [...new Set(iterFiles(args.paths))].sort(comparePaths);
    let findings: Finding[] = [];
    for (let filePath of unique) {
        findings.push(...lintFile(filePath, extraPatterns));
    }

    let cwd = process.cwd();
    for (let finding of findings) {
        process.stdout.write(`${formatFinding(finding, cwd)}\n`);
    }

    if (findings.length > 0) {
        process.stderr.write(`\n${findings.length} warning(s)\n`);
        return args.failOnWarnings ? 1 : 0;
    }

    process.stdout.write("No technical-writing warnings found.\n");
    return 0;
}

function argumentFailure(message: string): number {
    process.stderr.write(`${USAGE}\n${PROG}: error: ${message}\n`);
    return 2;
}

type ErrnoError = Error & { code?: string; errno?: number };

/** `strerror()` text for the failures that reading a rules file can produce. */
let ERRNO_MESSAGES: Record<string, string> = {
    ENOENT: "No such file or directory",
    EACCES: "Permission denied",
    EISDIR: "Is a directory",
    ENOTDIR: "Not a directory",
    ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long",
};

/** Mirrors `str(OSError)` and `str(UnicodeDecodeError)`, which argparse interpolates verbatim. */
function describeLoadFailure(error: unknown, path: string): string {
    if (error instanceof TypeError) {
        // TextDecoder reports neither the offending byte nor its offset, so the
        // detail Python appends to its UnicodeDecodeError cannot be reproduced.
        return "'utf-8' codec can't decode input: invalid start byte";
    }
    let failure = error as ErrnoError;
    if (typeof failure.code !== "string" || failure.errno === undefined) {
        return failure.message;
    }
    // libuv lowercases what strerror() capitalizes, and reports the errno negated.
    let fallback = getSystemErrorMap().get(failure.errno)?.[1] ?? failure.code;
    let text = ERRNO_MESSAGES[failure.code] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
    return `[Errno ${Math.abs(failure.errno)}] ${text}: ${pyRepr(path)}`;
}

if (import.meta.main) {
    process.exitCode = main(process.argv.slice(2));
}
