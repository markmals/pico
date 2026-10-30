import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { loadCatalog, referencesInLine, referencesInSource, swiftFiles } from "./check-symbols.ts";

test("takes literals that follow the label", () => {
    assert.deepEqual(referencesInLine('Image(systemName: "checklist")'), ["checklist"]);
    assert.deepEqual(referencesInLine('Label("Pinned", systemImage: "pin.fill")'), ["pin.fill"]);
});

test("ignores literals before the label", () => {
    // A Label's title is prose, and is not a symbol name even when it looks like one.
    assert.deepEqual(referencesInLine('Label("star", systemImage: "star.fill")'), ["star.fill"]);
});

test("checks both sides of a ternary", () => {
    assert.deepEqual(referencesInLine('.init(systemName: pinned ? "pin.fill" : "pin.slash")'), [
        "pin.fill",
        "pin.slash",
    ]);
});

test("treats uppercase or spaces as prose, not a symbol name", () => {
    assert.deepEqual(referencesInLine('Image(systemName: "Not A Symbol")'), []);
    assert.deepEqual(referencesInLine('Image(systemName: "checkList")'), []);
    assert.deepEqual(referencesInLine('Image(systemName: "")'), []);
    // Leading punctuation is not symbol-shaped either.
    assert.deepEqual(referencesInLine('Image(systemName: ".leading.dot")'), []);
});

test("ignores lines with no label at all", () => {
    assert.deepEqual(referencesInLine('Text("pin.fill")'), []);
});

test("reports one-based line numbers against the given path", () => {
    const source = ["import SwiftUI", "", 'Image(systemName: "not.a.real.symbol")'].join("\n");
    assert.deepEqual(referencesInSource(source, "Features/Row.swift"), [
        { file: "Features/Row.swift", line: 3, name: "not.a.real.symbol" },
    ]);
});

test("reads the symbol names out of the catalog's JSON", () => {
    const catalog = loadCatalog(
        JSON.stringify({ symbols: { checklist: "2021", "pin.fill": "2019" }, year_to_release: {} }),
    );
    assert.ok(catalog.has("checklist"));
    assert.ok(!catalog.has("not.a.real.symbol"));
    assert.equal(catalog.size, 2);
});

test("an unreadable catalog yields no known symbols rather than throwing", () => {
    assert.equal(loadCatalog("{}").size, 0);
    assert.equal(loadCatalog('{"symbols": null}').size, 0);
});

const root = mkdtempSync(path.join(os.tmpdir(), "check-symbols-test-"));
after(() => {
    rmSync(root, { recursive: true, force: true });
});

test("walks .swift files recursively, in a stable order", () => {
    mkdirSync(path.join(root, "Features"), { recursive: true });
    writeFileSync(path.join(root, "Features/b.swift"), "");
    writeFileSync(path.join(root, "Features/a.swift"), "");
    writeFileSync(path.join(root, "notes.md"), "");
    assert.deepEqual(
        swiftFiles(root).map(file => path.relative(root, file)),
        [path.join("Features", "a.swift"), path.join("Features", "b.swift")],
    );
});

test("a missing root walks nothing", () => {
    assert.deepEqual(swiftFiles(path.join(root, "nope")), []);
});
