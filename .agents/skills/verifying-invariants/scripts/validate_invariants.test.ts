import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import {
    DuplicateKeyError,
    JsonFloat,
    JsonSyntaxError,
    Validator,
    encodeJsonReport,
    encodeJsonString,
    helpText,
    loadManifest,
    main,
    parseArguments,
    parseJson,
    parseManifestText,
    posixPathDisplay,
    posixPathParts,
    rejectDuplicateKeys,
    usageText,
} from "./validate_invariants.ts";

let workspace = "";
let root = "";
let outside = "";

before(() => {
    workspace = mkdtempSync(join(tmpdir(), "validate-invariants-"));
    root = join(workspace, "project");
    outside = join(workspace, "outside");
    mkdirSync(join(root, "Sources"), { recursive: true });
    mkdirSync(join(root, "Documents"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "Sources", "Store.swift"), "");
    writeFileSync(join(root, "Documents", "contract.md"), "");
    writeFileSync(join(outside, "secret.txt"), "");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape"));
});

after(() => {
    rmSync(workspace, { recursive: true, force: true });
});

// An override set to undefined omits that field, which is how the fixtures
// exercise the missing-field rules.
function fields(
    base: Record<string, unknown>,
    overrides: Record<string, unknown>,
): Record<string, unknown> {
    let result = { ...base, ...overrides };
    for (let key of Object.keys(result)) {
        if (result[key] === undefined) {
            delete result[key];
        }
    }
    return result;
}

function invariant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return fields(
        {
            id: "store-commit",
            statement: "Committed state is always reachable.",
            kind: "structural",
            scope: { references: [{ path: "Sources/Store.swift", symbol: "Store.commit" }] },
            authority: {
                description: "Product contract.",
                references: [{ path: "Documents/contract.md" }],
            },
            boundaries: { surfaces: ["construction"], exclusions: [] },
            assumptions: [],
            checks: [
                { id: "unit", method: "property-test", command: "swift test", limitations: [] },
            ],
        },
        overrides,
    );
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return fields({ schema_version: 1, invariants: [invariant()] }, overrides);
}

function check(document: unknown): { code: string; message: string; path: string }[] {
    return new Validator(root).validate(document);
}

function codes(document: unknown): string[] {
    return check(document).map(item => item.code);
}

function withOneCheck(overrides: Record<string, unknown>): Record<string, unknown> {
    return manifest({ invariants: [invariant({ checks: [overrides] })] });
}

function capture(run: () => number): { code: number; out: string[]; err: string[] } {
    let out: string[] = [];
    let err: string[] = [];
    let log = console.log;
    let error = console.error;
    console.log = (line: unknown) => out.push(String(line));
    console.error = (line: unknown) => err.push(String(line));
    try {
        return { code: run(), out, err };
    } finally {
        console.log = log;
        console.error = error;
    }
}

describe("parseJson", () => {
    test("keeps integers and floats distinguishable", () => {
        assert.equal(parseJson("1"), 1);
        assert.ok(parseJson("1.0") instanceof JsonFloat);
        assert.equal((parseJson("1e0") as JsonFloat).value, 1);
        assert.ok(parseJson("NaN") instanceof JsonFloat);
        assert.equal((parseJson("-Infinity") as JsonFloat).value, Number.NEGATIVE_INFINITY);
    });

    test("parses the shapes a manifest uses", () => {
        // Parsed objects have a null prototype, so compare own entries.
        assert.deepEqual(
            { ...(parseJson('{"a": [1, true, false, null, "x"]}') as object) },
            { a: [1, true, false, null, "x"] },
        );
        assert.deepEqual(parseJson("[]"), []);
        assert.deepEqual(Object.keys(parseJson("{}") as object), []);
        assert.equal(parseJson('"\\ud83d\\ude00 caf\\u00e9\\n"'), "\u{1f600} café\n");
    });

    test("rejects duplicate object keys at every depth", () => {
        assert.throws(() => parseJson('{"a": 1, "a": 2}'), DuplicateKeyError);
        assert.throws(
            () => parseJson('{"b": {"a": 1, "a": 2}}'),
            (error: DuplicateKeyError) => error.key === "a",
        );
        // A syntax error later in the object is reported before the duplicate.
        assert.throws(
            () => parseJson('{"a": 1, "a": 2, bad}'),
            (error: JsonSyntaxError) => {
                return error.msg === "Expecting property name enclosed in double quotes";
            },
        );
    });

    test("keeps __proto__ as manifest data", () => {
        let parsed = parseJson('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
        assert.deepEqual(Object.keys(parsed), ["__proto__"]);
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
    });

    test("reports the same syntax messages the manifest format documents", () => {
        let cases: [string, string][] = [
            ["", "Expecting value"],
            ["   ", "Expecting value"],
            ["{", "Expecting property name enclosed in double quotes"],
            ["{'a': 1}", "Expecting property name enclosed in double quotes"],
            ['{"a" 1}', "Expecting ':' delimiter"],
            ['{"a":}', "Expecting value"],
            ['{"a": 1,}', "Illegal trailing comma before end of object"],
            ["[1,]", "Illegal trailing comma before end of array"],
            ["[1 2]", "Expecting ',' delimiter"],
            ["[1", "Expecting ',' delimiter"],
            ['"abc', "Unterminated string starting at"],
            ['"a\\qb"', "Invalid \\escape"],
            ['"a\\u00zz"', "Invalid \\uXXXX escape"],
            ['"a\nb"', "Invalid control character at"],
            ["{} x", "Extra data"],
            ["\ufeff{}", "Unexpected UTF-8 BOM (decode using utf-8-sig)"],
        ];
        for (let [text, msg] of cases) {
            assert.throws(
                () => parseJson(text),
                (error: JsonSyntaxError) => error.msg === msg,
                text,
            );
        }
    });

    test("rejectDuplicateKeys builds a null-prototype object", () => {
        let built = rejectDuplicateKeys([
            ["a", 1],
            ["b", 2],
        ]);
        assert.equal(Object.getPrototypeOf(built), null);
        assert.deepEqual(Object.entries(built), [
            ["a", 1],
            ["b", 2],
        ]);
        assert.throws(
            () =>
                rejectDuplicateKeys([
                    ["a", 1],
                    ["a", 2],
                ]),
            DuplicateKeyError,
        );
    });
});

describe("report encoding", () => {
    test("escapes to ASCII the way the JSON report requires", () => {
        assert.equal(encodeJsonString('a"b\\c'), '"a\\"b\\\\c"');
        assert.equal(encodeJsonString("\b\f\n\r\t"), '"\\b\\f\\n\\r\\t"');
        assert.equal(encodeJsonString("café"), '"caf\\u00e9"');
        assert.equal(encodeJsonString("\u{1f600}"), '"\\ud83d\\ude00"');
        assert.equal(encodeJsonString("\u0001"), '"\\u0001"');
    });

    test("writes diagnostics then valid, with sorted keys inside each diagnostic", () => {
        assert.equal(encodeJsonReport([], true), '{"diagnostics":[],"valid":true}');
        assert.equal(
            encodeJsonReport(
                [{ code: "schema.type", message: "must be an object", path: "/invariants/0" }],
                false,
            ),
            '{"diagnostics":[{"code":"schema.type","message":"must be an object","path":"/invariants/0"}],"valid":false}',
        );
    });
});

describe("path normalization", () => {
    test("mirrors PurePosixPath parts and display", () => {
        assert.deepEqual(posixPathParts("a/./b//c/"), ["a", "b", "c"]);
        assert.deepEqual(posixPathParts("."), []);
        assert.deepEqual(posixPathParts("a/../b"), ["a", "..", "b"]);
        assert.equal(posixPathDisplay(""), ".");
        assert.equal(posixPathDisplay("./a//b/"), "a/b");
        assert.equal(posixPathDisplay("/a/./b"), "/a/b");
        assert.equal(posixPathDisplay("//a"), "//a");
        assert.equal(posixPathDisplay("///a"), "/a");
    });
});

describe("schema validation", () => {
    test("accepts a well-formed manifest", () => {
        assert.deepEqual(check(manifest()), []);
    });

    test("requires an object document", () => {
        assert.deepEqual(check([]), [
            { code: "schema.type", message: "must be an object", path: "" },
        ]);
        assert.deepEqual(codes(null), ["schema.type"]);
        assert.deepEqual(codes("text"), ["schema.type"]);
    });

    test("requires schema_version to be the integer 1", () => {
        assert.deepEqual(codes(manifest({ schema_version: 2 })), ["schema.version"]);
        assert.deepEqual(codes(manifest({ schema_version: true })), ["schema.version"]);
        assert.deepEqual(codes(manifest({ schema_version: "1" })), ["schema.version"]);
        assert.deepEqual(
            codes(
                parseJson(
                    JSON.stringify(manifest()).replace(
                        '"schema_version":1',
                        '"schema_version":1.0',
                    ),
                ),
            ),
            ["schema.version"],
        );
        assert.deepEqual(codes(manifest({ schema_version: undefined })), [
            "schema.missing-field",
            "schema.version",
        ]);
    });

    test("rejects unknown and missing fields at every level", () => {
        assert.deepEqual(check(manifest({ extra: 1 })), [
            { code: "schema.unknown-field", message: "is not allowed", path: "/extra" },
        ]);
        let missing = check({ schema_version: 1 });
        assert.deepEqual(missing, [
            {
                code: "schema.missing-field",
                message: "missing required field 'invariants'",
                path: "",
            },
            { code: "schema.type", message: "must be an array", path: "/invariants" },
        ]);
        assert.deepEqual(codes(manifest({ invariants: [invariant({ surprise: 1 })] })), [
            "schema.unknown-field",
        ]);
        assert.deepEqual(
            check(manifest({ invariants: [invariant({ kind: undefined })] })),
            [
                {
                    code: "schema.missing-field",
                    message: "missing required field 'kind'",
                    path: "/invariants/0",
                },
            ].concat([
                { code: "schema.type", message: "must be a string", path: "/invariants/0/kind" },
            ]),
        );
    });

    test("requires a non-empty invariants array", () => {
        assert.deepEqual(check(manifest({ invariants: [] })), [
            { code: "schema.empty", message: "must not be empty", path: "/invariants" },
        ]);
        assert.deepEqual(codes(manifest({ invariants: {} })), ["schema.type"]);
        assert.deepEqual(codes(manifest({ invariants: [1] })), ["schema.type"]);
    });

    test("requires non-empty text where the format demands it", () => {
        assert.deepEqual(
            codes(manifest({ invariants: [invariant({ id: "   ", statement: "" })] })),
            ["schema.empty", "schema.empty"],
        );
        assert.deepEqual(codes(manifest({ invariants: [invariant({ id: 7 })] })), ["schema.type"]);
    });

    test("restricts kind to the documented set", () => {
        assert.deepEqual(check(manifest({ invariants: [invariant({ kind: "invented" })] })), [
            {
                code: "schema.value",
                message: "must be one of: external, refined-value, structural, transition",
                path: "/invariants/0/kind",
            },
        ]);
    });

    test("validates scope, authority, and boundaries objects", () => {
        assert.deepEqual(codes(manifest({ invariants: [invariant({ scope: [] })] })), [
            "schema.type",
        ]);
        assert.deepEqual(
            codes(manifest({ invariants: [invariant({ scope: { references: [], extra: 1 } })] })),
            ["schema.unknown-field", "schema.empty"],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [invariant({ authority: { references: [{ path: "." }] } })],
                }),
            ),
            ["schema.missing-field", "schema.type"],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [
                        invariant({ authority: { description: " ", references: [{ path: "." }] } }),
                    ],
                }),
            ),
            ["schema.empty"],
        );
    });

    test("restricts boundary surfaces and allows empty exclusions", () => {
        assert.deepEqual(
            check(
                manifest({
                    invariants: [
                        invariant({ boundaries: { surfaces: ["teleport"], exclusions: [] } }),
                    ],
                }),
            ),
            [
                {
                    code: "schema.value",
                    message:
                        "must be one of: construction, decoding, external, mutation, transition",
                    path: "/invariants/0/boundaries/surfaces/0",
                },
            ],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [invariant({ boundaries: { surfaces: [], exclusions: [] } })],
                }),
            ),
            ["schema.empty"],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [
                        invariant({ boundaries: { surfaces: ["construction"], exclusions: [""] } }),
                    ],
                }),
            ),
            ["schema.empty"],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [invariant({ boundaries: { surfaces: [1], exclusions: [] } })],
                }),
            ),
            ["schema.type"],
        );
    });

    test("allows empty assumptions but requires a list", () => {
        assert.deepEqual(check(manifest({ invariants: [invariant({ assumptions: [] })] })), []);
        assert.deepEqual(codes(manifest({ invariants: [invariant({ assumptions: {} })] })), [
            "schema.type",
        ]);
        assert.deepEqual(codes(manifest({ invariants: [invariant({ assumptions: [""] })] })), [
            "schema.empty",
        ]);
    });
});

describe("check validation", () => {
    test("requires a non-empty checks array of objects", () => {
        assert.deepEqual(codes(manifest({ invariants: [invariant({ checks: [] })] })), [
            "schema.empty",
        ]);
        assert.deepEqual(codes(manifest({ invariants: [invariant({ checks: [42] })] })), [
            "schema.type",
        ]);
    });

    test("restricts method to the documented set", () => {
        let diagnostics = check(
            withOneCheck({ id: "unit", method: "guesswork", command: "x", limitations: [] }),
        );
        assert.deepEqual(diagnostics, [
            {
                code: "schema.value",
                message:
                    "must be one of: artifact-inspection, boundary-test, bounded-exploration, compiler-rejection," +
                    " formal-proof, integration-test, manual-review, property-test, static-analysis, transition-test",
                path: "/invariants/0/checks/0/method",
            },
        ]);
    });

    test("requires command and/or artifact evidence", () => {
        assert.deepEqual(
            check(withOneCheck({ id: "unit", method: "manual-review", limitations: [] })),
            [
                {
                    code: "check.evidence",
                    message: "requires command and/or artifact",
                    path: "/invariants/0/checks/0",
                },
            ],
        );
        assert.deepEqual(
            check(
                withOneCheck({
                    id: "unit",
                    method: "manual-review",
                    artifact: { path: "." },
                    limitations: [],
                }),
            ),
            [],
        );
        assert.deepEqual(
            codes(
                withOneCheck({ id: "unit", method: "manual-review", command: 1, limitations: [] }),
            ),
            ["schema.type"],
        );
    });

    test("requires limitations and validates its members", () => {
        assert.deepEqual(
            codes(withOneCheck({ id: "unit", method: "manual-review", command: "x" })),
            ["schema.missing-field", "schema.type"],
        );
        assert.deepEqual(
            codes(
                withOneCheck({
                    id: "unit",
                    method: "manual-review",
                    command: "x",
                    limitations: [""],
                }),
            ),
            ["schema.empty"],
        );
    });

    test("validates bounded-exploration bounds", () => {
        let base = { id: "explore", method: "bounded-exploration", command: "x", limitations: [] };
        assert.deepEqual(codes(withOneCheck(base)), ["schema.type"]);
        assert.deepEqual(codes(withOneCheck({ ...base, bounds: {} })), [
            "schema.missing-field",
            "schema.type",
        ]);
        assert.deepEqual(codes(withOneCheck({ ...base, bounds: { domain: " " } })), [
            "schema.empty",
        ]);
        assert.deepEqual(check(withOneCheck({ ...base, bounds: { domain: "All 12 states" } })), []);
        assert.deepEqual(
            check(
                withOneCheck({ ...base, bounds: { domain: "All 12 states", resource_limits: {} } }),
            ),
            [
                {
                    code: "schema.empty",
                    message: "must not be empty when present",
                    path: "/invariants/0/checks/0/bounds/resource_limits",
                },
            ],
        );
        assert.deepEqual(
            check(
                withOneCheck({
                    ...base,
                    bounds: { domain: "d", resource_limits: { max_states: 0 } },
                }),
            ),
            [
                {
                    code: "bounds.value",
                    message: "must be a positive integer",
                    path: "/invariants/0/checks/0/bounds/resource_limits/max_states",
                },
            ],
        );
        assert.deepEqual(
            codes(
                withOneCheck({
                    ...base,
                    bounds: { domain: "d", resource_limits: { max_depth: true } },
                }),
            ),
            ["bounds.value"],
        );
        assert.deepEqual(
            codes(
                withOneCheck({
                    ...base,
                    bounds: { domain: "d", resource_limits: { max_seconds: new JsonFloat(1.5) } },
                }),
            ),
            ["bounds.value"],
        );
        assert.deepEqual(
            codes(withOneCheck({ ...base, bounds: { domain: "d", resource_limits: { nope: 1 } } })),
            ["schema.unknown-field"],
        );
        assert.deepEqual(
            check(
                withOneCheck({
                    ...base,
                    bounds: {
                        domain: "d",
                        resource_limits: { max_states: 12, max_depth: 3, max_seconds: 60 },
                    },
                }),
            ),
            [],
        );
    });

    test("rejects bounds on any other method", () => {
        assert.deepEqual(
            check(
                withOneCheck({
                    id: "unit",
                    method: "manual-review",
                    command: "x",
                    limitations: [],
                    bounds: { domain: "d" },
                }),
            ),
            [
                {
                    code: "schema.unexpected-field",
                    message: "is only allowed for bounded-exploration",
                    path: "/invariants/0/checks/0/bounds",
                },
            ],
        );
    });

    test("requires an implementation reference and assumptions for formal-proof", () => {
        let proof = {
            id: "proof",
            method: "formal-proof",
            artifact: { path: "." },
            limitations: [],
        };
        assert.deepEqual(check(withOneCheck(proof)), [
            {
                code: "formal-proof.assumptions",
                message: "must be non-empty when a formal-proof check is declared",
                path: "/invariants/0/assumptions",
            },
            {
                code: "formal-proof.implementation",
                message: "requires an implementation reference",
                path: "/invariants/0/checks/0",
            },
        ]);
        let complete = manifest({
            invariants: [
                invariant({
                    assumptions: ["The scheduler is fair."],
                    checks: [
                        {
                            ...proof,
                            implementation: { path: "Sources/Store.swift", symbol: "Store.commit" },
                        },
                    ],
                }),
            ],
        });
        assert.deepEqual(check(complete), []);
    });
});

describe("identity", () => {
    test("rejects duplicate invariant and check ids", () => {
        assert.deepEqual(check(manifest({ invariants: [invariant(), invariant()] })), [
            {
                code: "identity.duplicate-invariant",
                message: "duplicate invariant id 'store-commit'",
                path: "/invariants/1/id",
            },
        ]);
        let twoChecks = manifest({
            invariants: [
                invariant({
                    checks: [
                        { id: "unit", method: "property-test", command: "a", limitations: [] },
                        { id: "unit", method: "property-test", command: "b", limitations: [] },
                    ],
                }),
            ],
        });
        assert.deepEqual(check(twoChecks), [
            {
                code: "identity.duplicate-check",
                message: "duplicate check id 'unit'",
                path: "/invariants/0/checks/1/id",
            },
        ]);
    });

    test("does not report duplicates for ids already rejected as empty", () => {
        assert.deepEqual(
            codes(manifest({ invariants: [invariant({ id: "" }), invariant({ id: "" })] })),
            ["schema.empty", "schema.empty"],
        );
    });
});

describe("references", () => {
    test("accepts the project root and existing files", () => {
        assert.deepEqual(
            check(
                manifest({
                    invariants: [
                        invariant({ scope: { references: [{ path: "." }, { path: "Sources" }] } }),
                    ],
                }),
            ),
            [],
        );
    });

    test("rejects absolute paths and parent traversal", () => {
        let diagnostics = check(
            manifest({
                invariants: [
                    invariant({
                        scope: {
                            references: [
                                { path: "/etc/passwd" },
                                { path: "../outside/secret.txt" },
                            ],
                        },
                    }),
                ],
            }),
        );
        assert.deepEqual(diagnostics, [
            {
                code: "reference.path",
                message: "must be a relative path contained by --root",
                path: "/invariants/0/scope/references/0/path",
            },
            {
                code: "reference.path",
                message: "must be a relative path contained by --root",
                path: "/invariants/0/scope/references/1/path",
            },
        ]);
    });

    test("rejects paths that do not exist under the root", () => {
        assert.deepEqual(
            check(
                manifest({
                    invariants: [
                        invariant({ scope: { references: [{ path: "Sources/Missing.swift" }] } }),
                    ],
                }),
            ),
            [
                {
                    code: "reference.missing",
                    message: "does not exist under --root: Sources/Missing.swift",
                    path: "/invariants/0/scope/references/0/path",
                },
            ],
        );
    });

    test("rejects symlinks that resolve outside the root", () => {
        assert.deepEqual(
            check(
                manifest({
                    invariants: [invariant({ scope: { references: [{ path: "escape" }] } })],
                }),
            ),
            [
                {
                    code: "reference.escape",
                    message: "resolves outside --root",
                    path: "/invariants/0/scope/references/0/path",
                },
            ],
        );
    });

    test("validates reference shape", () => {
        let diagnostics = check(
            manifest({
                invariants: [
                    invariant({
                        scope: {
                            references: [
                                { symbol: "x" },
                                { path: ".", extra: 1 },
                                { path: ".", symbol: 2 },
                                "nope",
                            ],
                        },
                    }),
                ],
            }),
        );
        assert.deepEqual(diagnostics, [
            {
                code: "schema.missing-field",
                message: "missing required field 'path'",
                path: "/invariants/0/scope/references/0",
            },
            {
                code: "schema.type",
                message: "must be a string",
                path: "/invariants/0/scope/references/0/path",
            },
            {
                code: "schema.unknown-field",
                message: "is not allowed",
                path: "/invariants/0/scope/references/1/extra",
            },
            {
                code: "schema.type",
                message: "must be a string",
                path: "/invariants/0/scope/references/2/symbol",
            },
            {
                code: "schema.type",
                message: "must be an object",
                path: "/invariants/0/scope/references/3",
            },
        ]);
    });

    test("requires non-empty reference lists for scope and authority", () => {
        assert.deepEqual(
            codes(manifest({ invariants: [invariant({ scope: { references: [] } })] })),
            ["schema.empty"],
        );
        assert.deepEqual(
            codes(
                manifest({
                    invariants: [invariant({ authority: { description: "d", references: [] } })],
                }),
            ),
            ["schema.empty"],
        );
    });

    test("validates artifact and implementation references", () => {
        assert.deepEqual(
            codes(
                withOneCheck({
                    id: "unit",
                    method: "manual-review",
                    artifact: { path: "gone" },
                    limitations: [],
                }),
            ),
            ["reference.missing"],
        );
        assert.deepEqual(
            codes(
                withOneCheck({
                    id: "unit",
                    method: "manual-review",
                    command: "x",
                    implementation: { path: "gone" },
                    limitations: [],
                }),
            ),
            ["reference.missing"],
        );
    });
});

describe("diagnostic ordering", () => {
    test("sorts by path, then code, then message", () => {
        let diagnostics = check({
            schema_version: 2,
            invariants: [invariant({ kind: "nope", extra: 1 })],
            other: 1,
        });
        assert.deepEqual(
            diagnostics.map(item => `${item.path}|${item.code}`),
            [
                "/invariants/0/extra|schema.unknown-field",
                "/invariants/0/kind|schema.value",
                "/other|schema.unknown-field",
                "/schema_version|schema.version",
            ],
        );
    });
});

describe("manifest loading", () => {
    test("reports a missing manifest", () => {
        assert.deepEqual(loadManifest(join(root, "absent.json")).diagnostics, [
            {
                code: "manifest.missing",
                message: `file does not exist: ${join(root, "absent.json")}`,
                path: "",
            },
        ]);
    });

    test("reports a directory and an unreadable path", () => {
        assert.deepEqual(loadManifest(root).diagnostics, [
            { code: "manifest.not-file", message: `not a regular file: ${root}`, path: "" },
        ]);
        assert.deepEqual(
            loadManifest(join(root, "Sources", "Store.swift", "deeper.json")).diagnostics,
            [
                {
                    code: "manifest.unreadable",
                    message: "cannot read manifest: Not a directory",
                    path: "",
                },
            ],
        );
    });

    test("reports invalid UTF-8 before parsing", () => {
        let path = join(workspace, "invalid.json");
        writeFileSync(path, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]));
        assert.deepEqual(loadManifest(path).diagnostics, [
            { code: "manifest.invalid-encoding", message: "must be UTF-8", path: "" },
        ]);
    });

    test("reports duplicate keys and syntax errors", () => {
        assert.deepEqual(parseManifestText('{"a": 1, "a": 2}').diagnostics, [
            { code: "manifest.duplicate-key", message: "duplicate JSON object key: a", path: "" },
        ]);
        assert.deepEqual(parseManifestText('{"a": }').diagnostics, [
            { code: "manifest.invalid-json", message: "invalid JSON: Expecting value", path: "" },
        ]);
        assert.deepEqual(parseManifestText('{"a": 1}').diagnostics, []);
    });
});

describe("argument parsing", () => {
    test("accepts the documented surface in any order", () => {
        assert.deepEqual(parseArguments(["m.json", "--root", "p"]), {
            manifest: "m.json",
            root: "p",
            json: false,
            help: false,
            error: null,
        });
        assert.deepEqual(parseArguments(["--root", "p", "--json", "m.json"]), {
            manifest: "m.json",
            root: "p",
            json: true,
            help: false,
            error: null,
        });
        assert.deepEqual(parseArguments(["m.json", "--root=p"]).root, "p");
        assert.equal(parseArguments(["-h"]).help, true);
        assert.equal(parseArguments(["--help"]).help, true);
    });

    test("reports missing and unrecognized arguments", () => {
        assert.equal(
            parseArguments([]).error,
            "the following arguments are required: manifest, --root",
        );
        assert.equal(
            parseArguments(["m.json"]).error,
            "the following arguments are required: --root",
        );
        assert.equal(
            parseArguments(["--root", "p"]).error,
            "the following arguments are required: manifest",
        );
        assert.equal(parseArguments(["--root"]).error, "argument --root: expected one argument");
        assert.equal(parseArguments(["a", "b", "--root", "p"]).error, "unrecognized arguments: b");
        assert.equal(
            parseArguments(["--bogus", "a", "--root", "p"]).error,
            "unrecognized arguments: --bogus",
        );
    });
});

describe("command line behaviour", () => {
    let valid = "";
    let broken = "";

    before(() => {
        valid = join(workspace, "valid.json");
        broken = join(workspace, "broken.json");
        writeFileSync(valid, JSON.stringify(manifest()));
        writeFileSync(
            broken,
            JSON.stringify(manifest({ invariants: [invariant({ kind: "nope" })] })),
        );
    });

    test("exits 0 and reports well-formed manifests", () => {
        let result = capture(() => main([valid, "--root", root]));
        assert.equal(result.code, 0);
        assert.deepEqual(result.out, [
            "Invariant manifest is well-formed. No declared checks were executed.",
        ]);
        assert.deepEqual(result.err, []);
    });

    test("exits 1 and writes diagnostics to stderr", () => {
        let result = capture(() => main([broken, "--root", root]));
        assert.equal(result.code, 1);
        assert.deepEqual(result.out, []);
        assert.deepEqual(result.err, [
            "/invariants/0/kind: schema.value: must be one of: external, refined-value, structural, transition",
        ]);
    });

    test("writes a single JSON object on stdout with --json", () => {
        let okResult = capture(() => main([valid, "--root", root, "--json"]));
        assert.equal(okResult.code, 0);
        assert.deepEqual(okResult.out, ['{"diagnostics":[],"valid":true}']);
        let failResult = capture(() => main([broken, "--root", root, "--json"]));
        assert.equal(failResult.code, 1);
        assert.deepEqual(failResult.err, []);
        assert.deepEqual(JSON.parse(failResult.out[0]), {
            diagnostics: [
                {
                    code: "schema.value",
                    message: "must be one of: external, refined-value, structural, transition",
                    path: "/invariants/0/kind",
                },
            ],
            valid: false,
        });
    });

    test("uses '/' as the location for document-level diagnostics", () => {
        let result = capture(() => main([join(workspace, "absent.json"), "--root", root]));
        assert.equal(result.code, 1);
        assert.deepEqual(result.err, [
            `/: manifest.missing: file does not exist: ${join(workspace, "absent.json")}`,
        ]);
    });

    test("rejects a missing or non-directory root before reading the manifest", () => {
        let missing = capture(() => main([valid, "--root", join(workspace, "absent-root")]));
        assert.equal(missing.code, 1);
        assert.deepEqual(missing.err, [
            `/: root.missing: root does not exist: ${join(workspace, "absent-root")}`,
        ]);
        let notDirectory = capture(() => main([valid, "--root", valid]));
        assert.equal(notDirectory.code, 1);
        assert.deepEqual(notDirectory.err, [
            `/: root.not-directory: root is not a directory: ${valid}`,
        ]);
    });

    test("exits 2 with usage for bad arguments and 0 for --help", () => {
        let result = capture(() => main([valid]));
        assert.equal(result.code, 2);
        assert.deepEqual(result.err, [
            usageText(),
            "validate_invariants.ts: error: the following arguments are required: --root",
        ]);
        let help = capture(() => main(["--help"]));
        assert.equal(help.code, 0);
        assert.equal(help.out[0], helpText());
        assert.ok(
            helpText().startsWith(
                "usage: validate_invariants.ts [-h] --root ROOT [--json] manifest",
            ),
        );
    });

    test("never executes a declared command", () => {
        let sentinel = join(workspace, "executed.txt");
        let path = join(workspace, "command.json");
        writeFileSync(
            path,
            JSON.stringify(
                manifest({
                    invariants: [
                        invariant({
                            checks: [
                                {
                                    id: "unit",
                                    method: "property-test",
                                    command: `touch ${sentinel}`,
                                    limitations: [],
                                },
                            ],
                        }),
                    ],
                }),
            ),
        );
        let result = capture(() => main([path, "--root", root]));
        assert.equal(result.code, 0);
        assert.equal(loadManifest(sentinel).diagnostics[0].code, "manifest.missing");
    });
});

describe("unreadable manifests", () => {
    test(
        "reports a permission error",
        { skip: process.getuid?.() === 0 ? "runs as root" : false },
        () => {
            let path = join(workspace, "locked.json");
            writeFileSync(path, "{}");
            chmodSync(path, 0o000);
            try {
                assert.deepEqual(loadManifest(path).diagnostics, [
                    {
                        code: "manifest.unreadable",
                        message: "cannot read manifest: Permission denied",
                        path: "",
                    },
                ]);
            } finally {
                chmodSync(path, 0o600);
            }
        },
    );
});
