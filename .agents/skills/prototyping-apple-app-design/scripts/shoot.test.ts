import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    type CaptureOptions,
    buildErrorLines,
    bundleIdentifier,
    captureSuffix,
    extractEnumCases,
    launchFlags,
    simulatorNameFor,
} from "./shoot.ts";

const SKILL_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NO_OPTIONS: CaptureOptions = { variant: "", condition: "", appearance: "", textSize: "" };

test("a device name becomes a simulator name without spaces", () => {
    assert.equal(simulatorNameFor("iPhone 17 Pro"), "Prototype-iPhone-17-Pro");
    assert.equal(simulatorNameFor("iPad Pro 13-inch (M5)"), "Prototype-iPad-Pro-13-inch-(M5)");
});

test("reads the case names out of an enum block", () => {
    const source = [
        "enum Screen: String, CaseIterable {",
        "    case gallery",
        "    case noteList",
        "}",
    ].join("\n");
    assert.deepEqual(extractEnumCases(source, "Screen"), ["gallery", "noteList"]);
});

test("stops at the end of the enum", () => {
    const source = [
        "enum Screen: String {",
        "    case gallery",
        "}",
        "",
        "enum Condition: String {",
        "    case failing",
        "}",
    ].join("\n");
    assert.deepEqual(extractEnumCases(source, "Screen"), ["gallery"]);
});

test("ignores anything that is not a bare case on its own line", () => {
    const source = [
        "enum Screen: String {",
        "    case gallery",
        '    case noteList = "notes"',
        "    case a, b",
        "    // case commented",
        "    var id: String { rawValue }",
        "    func make(case name: String) {}",
        "}",
    ].join("\n");
    assert.deepEqual(extractEnumCases(source, "Screen"), ["gallery"]);
});

test("the template's own catalog still parses", () => {
    const catalog = readFileSync(
        path.join(SKILL_DIRECTORY, "template/Shared/Harness/ScreenCatalog.swift"),
        "utf8",
    );
    assert.deepEqual(extractEnumCases(catalog, "Screen"), ["gallery", "noteList", "noteDetail"]);
    const variants = readFileSync(
        path.join(SKILL_DIRECTORY, "template/Shared/Harness/Variant.swift"),
        "utf8",
    );
    assert.deepEqual(extractEnumCases(variants, "Variant"), ["baseline"]);
});

test("picks the first bundle identifier out of a project file", () => {
    const pbxproj = [
        "\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.prototype.reading;",
        "\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.prototype.reading.watchkitapp;",
    ].join("\n");
    assert.equal(bundleIdentifier(pbxproj), "com.prototype.reading");
    assert.equal(bundleIdentifier("nothing here"), "");
});

test("the template's project file carries the identifier new-prototype rewrites", () => {
    const pbxproj = readFileSync(
        path.join(SKILL_DIRECTORY, "template/Prototype.xcodeproj/project.pbxproj"),
        "utf8",
    );
    assert.equal(bundleIdentifier(pbxproj), "com.prototype.template");
});

test("every launch flag carries a value", () => {
    // A valueless flag consumes the next argument and leaves macOS windowless, so the
    // flag list must always be pairs.
    const flags = launchFlags("noteList", {
        variant: "dense",
        condition: "failing",
        appearance: "dark",
        textSize: "accessibility3",
    });
    assert.deepEqual(flags, [
        "-capture",
        "1",
        "-screen",
        "noteList",
        "-variant",
        "dense",
        "-condition",
        "failing",
        "-appearance",
        "dark",
        "-text-size",
        "accessibility3",
    ]);
    assert.equal(flags.length % 2, 0);
});

test("omits the knobs that were not asked for", () => {
    assert.deepEqual(launchFlags("gallery", NO_OPTIONS), ["-capture", "1", "-screen", "gallery"]);
});

test("the file name suffix names every knob, in flag order", () => {
    assert.equal(captureSuffix(NO_OPTIONS), "");
    assert.equal(captureSuffix({ ...NO_OPTIONS, condition: "failing" }), "-failing");
    assert.equal(
        captureSuffix({
            variant: "dense",
            condition: "empty",
            appearance: "dark",
            textSize: "accessibility3",
        }),
        "-dense-empty-dark-accessibility3",
    );
});

test("a failed build reports its diagnostics once each, sorted", () => {
    const log = [
        "CompileSwift normal arm64",
        "/tmp/p/Note.swift:3:5: error: cannot find 'Noteee' in scope",
        "/tmp/p/Note.swift:3:5: error: cannot find 'Noteee' in scope",
        "/tmp/p/App.swift:1:1: error: no such module 'Nope'",
        "warning: something harmless",
        "** BUILD FAILED **",
    ].join("\n");
    assert.deepEqual(buildErrorLines(log), [
        "/tmp/p/App.swift:1:1: error: no such module 'Nope'",
        "/tmp/p/Note.swift:3:5: error: cannot find 'Noteee' in scope",
    ]);
});

test("at most twenty diagnostics, so the real failure stays visible", () => {
    const log = Array.from(
        { length: 40 },
        (_unused, index) => `file${String(index).padStart(2, "0")}.swift: error: bad`,
    );
    assert.equal(buildErrorLines(log.join("\n")).length, 20);
});
