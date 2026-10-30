import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { compileCheckArguments, corpusArguments } from "./check_examples.ts";

const ROOT = "/skill";

test("the compile checks tolerate an unavailable compiler unless REQUIRE_SWIFTC=1", () => {
    assert.deepEqual(compileCheckArguments(ROOT, {}), [
        path.join(ROOT, "scripts", "swift_compile_checks.ts"),
        path.join(ROOT, "examples", "compile-checks.json"),
        "--allow-unavailable",
    ]);
    assert.deepEqual(
        compileCheckArguments(ROOT, { REQUIRE_SWIFTC: "0" }).at(-1),
        "--allow-unavailable",
    );
    assert.deepEqual(
        compileCheckArguments(ROOT, { REQUIRE_SWIFTC: "yes" }).at(-1),
        "--allow-unavailable",
    );
    assert.deepEqual(compileCheckArguments(ROOT, { REQUIRE_SWIFTC: "1" }), [
        path.join(ROOT, "scripts", "swift_compile_checks.ts"),
        path.join(ROOT, "examples", "compile-checks.json"),
    ]);
});

test("the corpus lane runs only when it is requested", () => {
    assert.equal(corpusArguments(ROOT, {}), null);
    assert.equal(corpusArguments(ROOT, { CHECK_SWIFT_COMPILER_CORPUS: "0" }), null);
    assert.deepEqual(corpusArguments(ROOT, { CHECK_SWIFT_COMPILER_CORPUS: "1" }), [
        path.join(ROOT, "scripts", "swift_compiler_corpus.ts"),
        path.join(ROOT, "examples", "compiler-corpus-map.json"),
    ]);
    assert.deepEqual(
        corpusArguments(ROOT, { CHECK_SWIFT_COMPILER_CORPUS: "1", SWIFT_FRONTEND: "" }).at(-1),
        path.join(ROOT, "examples", "compiler-corpus-map.json"),
    );
    assert.deepEqual(
        corpusArguments(ROOT, {
            CHECK_SWIFT_COMPILER_CORPUS: "1",
            SWIFT_FRONTEND: "/bin/swift-frontend",
        }),
        [
            path.join(ROOT, "scripts", "swift_compiler_corpus.ts"),
            path.join(ROOT, "examples", "compiler-corpus-map.json"),
            "--swiftc",
            "/bin/swift-frontend",
        ],
    );
});
