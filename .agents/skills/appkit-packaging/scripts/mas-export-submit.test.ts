import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    UsageError,
    absolutePath,
    altoolKeyPath,
    buildExportOptionsPlist,
    defaultArchivePath,
    firstPackage,
    parseMasArgs,
    validateMasOptions,
    type MasOptions,
} from "./mas-export-submit.ts";

const COMPLETE: MasOptions = {
    archivePath: "./build/My.xcarchive",
    scheme: "",
    exportOptions: "",
    teamId: "TEAMID1234",
    exportPath: "./export",
    keyId: "ABC123",
    issuerId: "69a6de7f-dead-beef",
    p8Path: "",
    upload: true,
    help: false,
};

test("parseMasArgs defaults the export path and uploads unless told not to", () => {
    const options = parseMasArgs(["-a", "My.xcarchive", "-k", "ABC123", "-i", "ISSUER"], {});
    assert.equal(options.archivePath, "My.xcarchive");
    assert.equal(options.exportPath, "./export");
    assert.equal(options.upload, true);
    assert.equal(parseMasArgs(["-a", "My.xcarchive", "--no-upload"], {}).upload, false);
});

test("parseMasArgs accepts long flags and env equivalents, flags winning", () => {
    const env = { ARCHIVE_PATH: "env.xcarchive", TEAM_ID: "ENVTEAM", EXPORT_PATH: "/env/export" };
    assert.equal(parseMasArgs([], env).archivePath, "env.xcarchive");
    assert.equal(parseMasArgs([], env).exportPath, "/env/export");
    assert.equal(parseMasArgs(["--team-id", "FLAGTEAM"], env).teamId, "FLAGTEAM");
    assert.equal(parseMasArgs(["--export-options", "E.plist"], env).exportOptions, "E.plist");
});

test("parseMasArgs rejects unknown arguments", () => {
    assert.throws(
        () => parseMasArgs(["--nope"], {}),
        (error: unknown) =>
            error instanceof UsageError && error.message === "unknown argument: --nope",
    );
    assert.throws(
        () => parseMasArgs(["stray"], {}),
        (error: unknown) =>
            error instanceof UsageError && error.message === "unknown argument: stray",
    );
});

test("validateMasOptions needs an archive or a scheme", () => {
    assert.throws(
        () => validateMasOptions({ ...COMPLETE, archivePath: "" }),
        (error: unknown) =>
            error instanceof UsageError &&
            error.message === "supply --archive PATH or --scheme NAME",
    );
    validateMasOptions({ ...COMPLETE, archivePath: "", scheme: "MyApp" });
});

test("validateMasOptions demands the ASC key only when it will upload", () => {
    assert.throws(
        () => validateMasOptions({ ...COMPLETE, keyId: "" }),
        (error: unknown) =>
            error instanceof UsageError &&
            error.message === "--key-id / KEY_ID required (or pass --no-upload)",
    );
    // A Team key needs the issuer; an Individual key would 401 with it, which is
    // why the message says so rather than silently passing --apiIssuer.
    assert.throws(
        () => validateMasOptions({ ...COMPLETE, issuerId: "" }),
        (error: unknown) =>
            error instanceof UsageError &&
            error.message ===
                "--issuer-id / ISSUER_ID required (Team key; OMIT only for INDIVIDUAL keys)",
    );
    validateMasOptions({ ...COMPLETE, keyId: "", issuerId: "", upload: false });
});

test("defaultArchivePath puts the archive under ./build", () => {
    assert.equal(defaultArchivePath("MyApp"), "./build/MyApp.xcarchive");
});

test("buildExportOptionsPlist writes method=app-store-connect, never the deprecated app-store", () => {
    const plist = buildExportOptionsPlist("TEAMID1234");
    assert.equal(
        plist,
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0">',
            "<dict>",
            "    <key>method</key>",
            "    <string>app-store-connect</string>",
            "    <key>teamID</key>",
            "    <string>TEAMID1234</string>",
            "    <key>signingStyle</key>",
            "    <string>automatic</string>",
            "</dict>",
            "</plist>",
            "",
        ].join("\n"),
    );
    assert.ok(!/<string>app-store<\/string>/.test(plist));
});

const plutil = spawnSync("plutil", ["-help"]);
const havePlutil = !plutil.error;

test("buildExportOptionsPlist output survives plutil", { skip: !havePlutil }, () => {
    const dir = mkdtempSync(join(tmpdir(), "appkit-packaging-plist."));
    const path = join(dir, "ExportOptions.plist");
    writeFileSync(path, buildExportOptionsPlist("TEAMID1234"));

    const lint = spawnSync("plutil", ["-lint", path], { encoding: "utf8" });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);

    const method = spawnSync("plutil", ["-extract", "method", "raw", "-o", "-", path], {
        encoding: "utf8",
    });
    assert.equal(method.stdout.trim(), "app-store-connect");

    const team = spawnSync("plutil", ["-extract", "teamID", "raw", "-o", "-", path], {
        encoding: "utf8",
    });
    assert.equal(team.stdout.trim(), "TEAMID1234");
});

test("firstPackage picks the flat installer out of the export directory", () => {
    assert.equal(
        firstPackage(["Packaging.log", "MyApp.pkg", "DistributionSummary.plist"]),
        "MyApp.pkg",
    );
    assert.equal(firstPackage(["Packaging.log", "ExportOptions.plist"]), undefined);
    assert.equal(firstPackage([]), undefined);
});

test("altoolKeyPath spells the one filename altool will search for", () => {
    assert.equal(
        altoolKeyPath("/Users/someone", "ABC123"),
        "/Users/someone/.appstoreconnect/private_keys/AuthKey_ABC123.p8",
    );
});

test("absolutePath matches the shell's dirname/pwd/basename dance", () => {
    assert.equal(absolutePath("key.p8", "/work"), "/work/key.p8");
    assert.equal(absolutePath("../key.p8", "/work/sub"), "/work/key.p8");
    assert.equal(absolutePath("/abs/key.p8", "/work"), "/abs/key.p8");
});
