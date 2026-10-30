import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    comparePaths,
    compilePattern,
    displayPath,
    formatFinding,
    isProbablyCodeLine,
    iterFiles,
    lintFile,
    lintLines,
    loadRules,
    normalizePath,
    parseArguments,
    pyStrip,
    splitLines,
    suffixOf,
} from "./lint_technical_writing.ts";

let SCRIPT = fileURLToPath(new URL("./lint_technical_writing.ts", import.meta.url));
let workspace = mkdtempSync(join(tmpdir(), "lint-technical-writing-"));

after(() => {
    rmSync(workspace, { recursive: true, force: true });
});

function write(relative: string, contents: string): string {
    let target = join(workspace, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
    return target;
}

function codesFor(text: string, suffix = ".md"): string[] {
    return lintLines(splitLines(text), suffix).map(finding => finding.code);
}

function run(args: string[], cwd = workspace): { status: number; stdout: string; stderr: string } {
    let result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("built-in rules", () => {
    test("filler flags each filler word and nothing else", () => {
        for (let word of ["just", "simply", "basically", "essentially", "obviously", "clearly"]) {
            assert.deepEqual(codesFor(`We ${word} ship the parser.`), ["filler"], word);
        }
        assert.deepEqual(codesFor("We ship the parser."), []);
    });

    test("filler is case-insensitive and respects word boundaries", () => {
        assert.deepEqual(codesFor("Just restart the daemon."), ["filler"]);
        assert.deepEqual(codesFor("The adjuster clearance was adjusted."), []);
    });

    test("filler honors Unicode word boundaries the way Python does", () => {
        // JavaScript's \b is ASCII-only, so a naive port would flag "naïvejust".
        assert.deepEqual(codesFor("The word naïvejust is one token."), []);
        assert.deepEqual(codesFor("Visit the café just once."), ["filler"]);
    });

    test("chatbot flags conversational scaffolding", () => {
        for (let phrase of [
            "Sure",
            "Certainly",
            "Great",
            "Awesome",
            "Let me",
            "I'll",
            "Here's",
            "Here is",
            "Let's dive in",
        ]) {
            assert.deepEqual(codesFor(`${phrase} describe the handshake.`), ["chatbot"], phrase);
        }
        assert.deepEqual(codesFor("The handshake has three steps."), []);
    });

    test("word-choice flags utilize and its inflections in both spellings", () => {
        for (let word of ["utilize", "utilizes", "utilized", "utilise", "utilises"]) {
            assert.deepEqual(codesFor(`The cache ${word} sharding.`), ["word-choice"], word);
        }
        assert.deepEqual(codesFor("The cache uses sharding."), []);
        // The rule spells the suffix as "e" plus "ing", so the dropped-e participle
        // and the agent noun stay unflagged; the Python original behaved the same way.
        assert.deepEqual(codesFor("The cache is utilizing sharding."), []);
        assert.deepEqual(codesFor("The utiliser is idle."), []);
    });

    test("vague-leverage flags leverage and its inflections", () => {
        for (let word of ["leverage", "leverages", "leveraged"]) {
            assert.deepEqual(codesFor(`We ${word} the index.`), ["vague-leverage"], word);
        }
        assert.deepEqual(codesFor("We query the index."), []);
        assert.deepEqual(codesFor("We are leveraging the index."), []);
    });

    test("marketing flags unproven claims", () => {
        for (let word of ["seamless", "robust", "powerful", "easy", "straightforward"]) {
            assert.deepEqual(codesFor(`The migration is ${word}.`), ["marketing"], word);
        }
        assert.deepEqual(codesFor("The migration takes two minutes."), []);
    });

    test("overqualified flags throat-clearing phrases", () => {
        for (let phrase of [
            "It should be noted that",
            "It is important to note that",
            "As previously mentioned",
        ]) {
            assert.deepEqual(
                codesFor(`${phrase} the queue drains first.`),
                ["overqualified"],
                phrase,
            );
        }
        assert.deepEqual(codesFor("The queue drains first."), []);
    });

    test("hedge flags compound hedges", () => {
        for (let phrase of ["could potentially", "may or may not", "might possibly"]) {
            assert.deepEqual(codesFor(`The retry ${phrase} fire twice.`), ["hedge"], phrase);
        }
        assert.deepEqual(codesFor("The retry fires at most twice."), []);
    });

    test("one line can trip several rules, in rule order", () => {
        assert.deepEqual(codesFor("Sure, we just leverage a powerful cache!"), [
            "exclamation",
            "filler",
            "chatbot",
            "vague-leverage",
            "marketing",
        ]);
    });
});

describe("exclamation rule", () => {
    test("flags exclamation points in prose", () => {
        assert.deepEqual(codesFor("The build finished!"), ["exclamation"]);
    });

    test("ignores shebangs and HTML comments", () => {
        assert.deepEqual(codesFor("#!/usr/bin/env bun"), []);
        assert.deepEqual(codesFor("<!-- TODO: rewrite! -->"), []);
    });

    test("ignores the callout marker but not prose after it", () => {
        assert.deepEqual(codesFor("> [!NOTE]"), []);
        assert.deepEqual(codesFor("> [!WARNING] Disk fills up fast!"), ["exclamation"]);
        for (let kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
            assert.deepEqual(codesFor(`> [!${kind}]`), [], kind);
        }
    });

    test("ignores exclamation points inside code spans", () => {
        assert.deepEqual(codesFor("Run `make all!` to build."), []);
    });
});

describe("markdown structure", () => {
    test("code-fence-language flags an untagged fence once", () => {
        assert.deepEqual(codesFor("```\njust text!\n```\n"), ["code-fence-language"]);
    });

    test("a tagged fence is accepted and its body is skipped", () => {
        assert.deepEqual(codesFor("```sh\necho just simply!\n```\n"), []);
    });

    test("a longer closing fence ends the block and a shorter one does not", () => {
        assert.deepEqual(codesFor("````js\njust\n````\nIt is easy.\n"), ["marketing"]);
        assert.deepEqual(codesFor("````js\n```\nstill fenced, just text\n````\nIt is easy.\n"), [
            "marketing",
        ]);
    });

    test("an unterminated fence swallows the rest of the file", () => {
        assert.deepEqual(codesFor("```sh\nIt is easy.\n"), []);
    });

    test("fences are only a Markdown concept", () => {
        assert.deepEqual(codesFor("/// ```\n/// It is easy.\n", ".swift"), ["marketing"]);
    });

    test("table rows are skipped", () => {
        assert.deepEqual(codesFor("| Name | Just simply |"), []);
        assert.deepEqual(codesFor("   | indented row is just as skipped |"), []);
    });

    test("code spans are removed before matching", () => {
        assert.deepEqual(codesFor("The `just` flag is documented."), []);
        assert.deepEqual(codesFor("The `just` flag is just documented."), ["filler"]);
    });
});

describe("code-line detection", () => {
    test("declaration prefixes are treated as code", () => {
        for (let prefix of [
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
        ]) {
            assert.equal(isProbablyCodeLine(`${prefix}Simply`, false, ".md"), true, prefix);
        }
        assert.equal(isProbablyCodeLine("Importing is simple", false, ".md"), false);
    });

    test("everything inside a fence is code", () => {
        assert.equal(isProbablyCodeLine("plain prose", true, ".md"), true);
    });

    test("Swift lines are code unless they are documentation comments", () => {
        assert.equal(isProbablyCodeLine("    return name", false, ".swift"), true);
        assert.equal(isProbablyCodeLine("    /// Returns the name.", false, ".swift"), false);
        assert.equal(isProbablyCodeLine("    /** Returns the name. */", false, ".swift"), false);
        assert.equal(isProbablyCodeLine("     * Returns the name.", false, ".swift"), false);
    });

    test("Swift comment markers are stripped before matching", () => {
        assert.deepEqual(codesFor("/// It is seamless!", ".swift"), ["exclamation", "marketing"]);
        assert.deepEqual(codesFor("let seamless = 1 // just", ".swift"), []);
    });
});

describe("text handling", () => {
    test("splitLines matches Python's universal newlines", () => {
        assert.deepEqual(splitLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
        assert.deepEqual(splitLines("trailing\n"), ["trailing"]);
        assert.deepEqual(splitLines("blank\n\n"), ["blank", ""]);
        assert.deepEqual(splitLines(""), []);
    });

    test("pyStrip trims the characters Python calls whitespace", () => {
        assert.equal(pyStrip("\u00a0 text \u001c"), "text");
        assert.equal(pyStrip("\ufefftext"), "\ufefftext");
    });

    test("suffixOf matches PurePath.suffix", () => {
        assert.equal(suffixOf("docs/readme.md"), ".md");
        assert.equal(suffixOf("docs/archive.tar.markdown"), ".markdown");
        assert.equal(suffixOf("docs/.md"), "");
        assert.equal(suffixOf("docs/README"), "");
    });

    test("normalizePath matches str(Path(...))", () => {
        assert.equal(normalizePath("./docs/"), "docs");
        assert.equal(normalizePath("docs//guide.md"), "docs/guide.md");
        assert.equal(normalizePath(""), ".");
        assert.equal(normalizePath("/"), "/");
        assert.equal(normalizePath("//host/share"), "//host/share");
        assert.equal(normalizePath("docs/../a.md"), "docs/../a.md");
    });

    test("comparePaths orders by path component, like sorted() over Path", () => {
        let paths = ["a/b.md", "a.c", "a/B.md", "a-b.md", "a/b/c.md", "x/y.md"];
        assert.deepEqual([...paths].sort(comparePaths), [
            "a/B.md",
            "a/b/c.md",
            "a/b.md",
            "a-b.md",
            "a.c",
            "x/y.md",
        ]);
    });

    test("displayPath strips the working directory only when it is a prefix", () => {
        assert.equal(displayPath("/work/docs/a.md", "/work"), "docs/a.md");
        assert.equal(displayPath("/workshop/a.md", "/work"), "/workshop/a.md");
        assert.equal(displayPath("docs/a.md", "/work"), "docs/a.md");
    });

    test("formatFinding renders the two-line report", () => {
        assert.equal(
            formatFinding(
                {
                    path: "/work/a.md",
                    lineNumber: 7,
                    code: "filler",
                    message: "Remove it.",
                    text: "   just   ",
                },
                "/work",
            ),
            "a.md:7: filler: Remove it.\n  just",
        );
    });
});

describe("file discovery", () => {
    test("reads only known extensions, skips build directories, and recurses", () => {
        write("tree/a.md", "just\n");
        write("tree/b.mdx", "just\n");
        write("tree/c.markdown", "just\n");
        write("tree/d.swift", "/// just\n");
        write("tree/e.txt", "just\n");
        write("tree/nested/f.md", "just\n");
        write("tree/node_modules/g.md", "just\n");
        write("tree/.git/h.md", "just\n");
        let found = iterFiles([join(workspace, "tree")]).sort(comparePaths);
        assert.deepEqual(
            found.map(path => path.slice(workspace.length + 1)),
            ["tree/a.md", "tree/b.mdx", "tree/c.markdown", "tree/d.swift", "tree/nested/f.md"],
        );
    });

    test("named files bypass nothing but the extension filter", () => {
        let text = write("pick/a.md", "just\n");
        let other = write("pick/a.txt", "just\n");
        assert.deepEqual(iterFiles([text, other, join(workspace, "pick/missing.md")]), [text]);
    });

    test("undecodable files are skipped instead of crashing", () => {
        let target = join(workspace, "binary.md");
        writeFileSync(target, Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x21, 0x0a]));
        assert.deepEqual(lintFile(target), []);
    });

    test("lintFile reports the path it was given", () => {
        let target = write("one.md", "It is easy.\n");
        assert.deepEqual(lintFile(target), [
            {
                path: target,
                lineNumber: 1,
                code: "marketing",
                message: "Prove this claim or replace it with the concrete behavior.",
                text: "It is easy.",
            },
        ]);
    });
});

describe("rules files", () => {
    test("appends rules after the built-ins", () => {
        let rules = loadRules(
            JSON.stringify([
                { code: "product", pattern: "examplecloud", message: "Use ExampleCloud." },
            ]),
        );
        assert.equal(rules.length, 1);
        assert.deepEqual(
            lintLines(["We ship examplecloud, just today."], ".md", rules).map(
                finding => finding.code,
            ),
            ["filler", "product"],
        );
    });

    test("an empty list adds no rules", () => {
        assert.deepEqual(loadRules("[]"), []);
    });

    test("rejects malformed rule files", () => {
        let cases: [string, string][] = [
            ["{}", "expected a JSON list of rule objects"],
            [
                '[{"code": "a", "pattern": "b"}]',
                "rule 1: expected an object with code, pattern, and message",
            ],
            [
                '[{"code": "a", "pattern": "b", "message": "c", "extra": 1}]',
                "rule 1: expected an object with code, pattern, and message",
            ],
            ['["nope"]', "rule 1: expected an object with code, pattern, and message"],
            [
                '[{"code": "a", "pattern": "b", "message": "  "}]',
                "rule 1: message must be a nonempty string",
            ],
            [
                '[{"code": "a", "pattern": 7, "message": "c"}]',
                "rule 1: pattern must be a nonempty string",
            ],
            [
                '[{"code": "a b", "pattern": "b", "message": "c"}]',
                "rule 1: code must not contain whitespace",
            ],
            [
                '[{"code": "filler", "pattern": "b", "message": "c"}]',
                "rule 1: duplicate or reserved code 'filler'",
            ],
            [
                '[{"code": "exclamation", "pattern": "b", "message": "c"}]',
                "rule 1: duplicate or reserved code 'exclamation'",
            ],
            [
                '[{"code": "code-fence-language", "pattern": "b", "message": "c"}]',
                "rule 1: duplicate or reserved code 'code-fence-language'",
            ],
            [
                '[{"code": "a", "pattern": "b", "message": "c"}, {"code": "a", "pattern": "d", "message": "e"}]',
                "rule 2: duplicate or reserved code 'a'",
            ],
        ];
        for (let [text, message] of cases) {
            assert.throws(() => loadRules(text), { message }, text);
        }
    });

    test("reports invalid patterns with the rule index and code", () => {
        assert.throws(() => loadRules('[{"code": "a", "pattern": "(", "message": "c"}]'), {
            message: /^rule 1 \(a\): invalid pattern: /,
        });
    });

    test("reports unparseable JSON", () => {
        assert.throws(() => loadRules("not json"), { message: /^invalid JSON: / });
    });
});

describe("Python pattern compatibility", () => {
    test("honors a leading inline flag group", () => {
        assert.equal(compilePattern("(?i)flaky").test("FLAKY"), true);
        assert.equal(compilePattern("flaky").test("FLAKY"), false);
        assert.equal(compilePattern("(?is)a.b").test("A\nB"), true);
        assert.equal(compilePattern("(?m)^b").test("a\nb"), true);
    });

    test("translates Python named groups and backreferences", () => {
        assert.equal(compilePattern("(?P<word>ab)-(?P=word)").test("ab-ab"), true);
        assert.equal(compilePattern("(?P<word>ab)-(?P=word)").test("ab-cd"), false);
    });

    test("leaves bracketed text that merely looks like a named group alone", () => {
        assert.equal(compilePattern("[(?P<]+").test("(?P<"), true);
    });

    test("rejects verbose patterns rather than misreading them", () => {
        assert.throws(() => compilePattern("(?x) a b"), /verbose/);
    });
});

describe("argument parsing", () => {
    test("collects paths and flags", () => {
        assert.deepEqual(parseArguments(["./docs/", "README.md"]), {
            paths: ["docs", "README.md"],
            failOnWarnings: false,
            rulesFile: null,
        });
        assert.deepEqual(parseArguments(["--fail-on-warnings", "a.md"]), {
            paths: ["a.md"],
            failOnWarnings: true,
            rulesFile: null,
        });
        assert.deepEqual(parseArguments(["--rules-file", "r.json", "a.md"]), {
            paths: ["a.md"],
            failOnWarnings: false,
            rulesFile: "r.json",
        });
        assert.deepEqual(parseArguments(["--rules-file=./r.json", "a.md"]), {
            paths: ["a.md"],
            failOnWarnings: false,
            rulesFile: "r.json",
        });
        assert.deepEqual(parseArguments(["--", "--weird.md"]), {
            paths: ["--weird.md"],
            failOnWarnings: false,
            rulesFile: null,
        });
    });

    test("reports argparse diagnostics", () => {
        assert.throws(() => parseArguments([]), {
            message: "the following arguments are required: paths",
        });
        assert.throws(() => parseArguments(["--bogus", "a.md"]), {
            message: "unrecognized arguments: --bogus",
        });
        assert.throws(() => parseArguments(["--rules-file"]), {
            message: "argument --rules-file: expected one argument",
        });
        assert.throws(() => parseArguments(["--fail-on-warnings=x", "a.md"]), {
            message: "argument --fail-on-warnings: ignored explicit argument 'x'",
        });
    });
});

describe("command line", () => {
    test("reports findings on stdout, the count on stderr, and exits 0", () => {
        write("cli/bad.md", "We just leverage it.\n");
        let result = run(["cli/bad.md"]);
        assert.equal(result.status, 0);
        assert.equal(
            result.stdout,
            "cli/bad.md:1: filler: Remove filler unless it changes the technical meaning.\n  We just leverage it.\n" +
                "cli/bad.md:1: vague-leverage: Replace 'leverage' with a more precise verb.\n  We just leverage it.\n",
        );
        assert.equal(result.stderr, "\n2 warning(s)\n");
    });

    test("--fail-on-warnings turns the same findings into exit status 1", () => {
        write("cli/bad.md", "We just leverage it.\n");
        let result = run(["--fail-on-warnings", "cli/bad.md"]);
        assert.equal(result.status, 1);
        assert.equal(result.stderr, "\n2 warning(s)\n");
    });

    test("clean input exits 0 with a single line on stdout", () => {
        write("clean/ok.md", "The parser reads one line at a time.\n");
        let result = run(["clean"]);
        assert.deepEqual(
            [result.status, result.stdout, result.stderr],
            [0, "No technical-writing warnings found.\n", ""],
        );
    });

    test("directories, duplicates, and extra arguments produce one sorted report", () => {
        write("walk/b.md", "It is easy.\n");
        write("walk/a/c.md", "It is robust.\n");
        let result = run(["walk", "walk/b.md", "walk"]);
        assert.equal(result.status, 0);
        assert.deepEqual(
            result.stdout.split("\n").filter(line => line.includes(": marketing:")),
            [
                "walk/a/c.md:1: marketing: Prove this claim or replace it with the concrete behavior.",
                "walk/b.md:1: marketing: Prove this claim or replace it with the concrete behavior.",
            ],
        );
    });

    test("a lone '.' reports discovered paths without a ./ prefix", () => {
        write("dot/a.md", "It is easy.\n");
        write("dot/sub/b.md", "It is robust.\n");
        let result = run(["."], join(workspace, "dot"));
        assert.deepEqual(
            result.stdout.split("\n").filter(line => line.includes(": marketing:")),
            [
                "a.md:1: marketing: Prove this claim or replace it with the concrete behavior.",
                "sub/b.md:1: marketing: Prove this claim or replace it with the concrete behavior.",
            ],
        );
    });

    test("invalid arguments exit 2 with usage on stderr", () => {
        let result = run([]);
        assert.equal(result.status, 2);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /^usage: lint_technical_writing\.ts /);
        assert.match(result.stderr, /error: the following arguments are required: paths\n$/);
    });

    test("an unreadable rules file exits 2", () => {
        let result = run(["--rules-file", "missing.json", "clean"]);
        assert.equal(result.status, 2);
        assert.match(
            result.stderr,
            /error: cannot load rules file missing\.json: \[Errno 2\] No such file or directory: 'missing\.json'\n$/,
        );
    });

    test("--rules-file appends project rules", () => {
        write(
            "rules.json",
            JSON.stringify([
                { code: "product", pattern: "(?i)examplecloud", message: "Use ExampleCloud." },
            ]),
        );
        write("terms/a.md", "We ship ExampleCloud.\n");
        let result = run(["--rules-file", "rules.json", "--fail-on-warnings", "terms"]);
        assert.equal(result.status, 1);
        assert.equal(
            result.stdout,
            "terms/a.md:1: product: Use ExampleCloud.\n  We ship ExampleCloud.\n",
        );
    });

    test("--help prints usage and exits 0", () => {
        let result = run(["--help"]);
        assert.equal(result.status, 0);
        assert.match(
            result.stdout,
            /^usage: lint_technical_writing\.ts \[-h\] \[--fail-on-warnings\]\n/,
        );
        assert.match(result.stdout, /\n {2}--rules-file RULES_FILE\n/);
        assert.equal(result.stderr, "");
    });
});
