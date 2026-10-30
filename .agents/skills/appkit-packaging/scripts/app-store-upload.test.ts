import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    UsageError,
    absolutePath,
    altoolKeyPath,
    isFlatPackage,
    missingRequired,
    onPath,
    parseUploadArgs,
    type UploadOptions,
} from "./app-store-upload.ts";

const COMPLETE: UploadOptions = {
    pkgPath: "App.pkg",
    keyId: "ABC123",
    issuerId: "69a6de7f-dead-beef",
    p8Path: "AuthKey_ABC123.p8",
    help: false,
};

test("parseUploadArgs reads the getopts short flags", () => {
    const options = parseUploadArgs(
        ["-f", "App.pkg", "-k", "ABC123", "-i", "ISSUER", "-p", "AuthKey_ABC123.p8"],
        {},
    );
    assert.deepEqual(options, {
        pkgPath: "App.pkg",
        keyId: "ABC123",
        issuerId: "ISSUER",
        p8Path: "AuthKey_ABC123.p8",
        help: false,
    });
});

test("parseUploadArgs seeds from the env, then lets flags win", () => {
    const env = {
        PKG_PATH: "env.pkg",
        KEY_ID: "ENVKEY",
        ISSUER_ID: "ENVISSUER",
        P8_PATH: "env.p8",
    };
    assert.equal(parseUploadArgs([], env).pkgPath, "env.pkg");
    assert.equal(parseUploadArgs(["-f", "flag.pkg"], env).pkgPath, "flag.pkg");
    assert.equal(parseUploadArgs(["-f", "flag.pkg"], env).keyId, "ENVKEY");
});

test("parseUploadArgs reports a bad flag the way getopts did", () => {
    assert.throws(
        () => parseUploadArgs(["-z"], {}),
        (error: unknown) => error instanceof UsageError && error.message === "unknown flag -z",
    );
    assert.throws(
        () => parseUploadArgs(["-f"], {}),
        (error: unknown) =>
            error instanceof UsageError && error.message === "flag -f requires an argument",
    );
});

test("missingRequired lists every unset value, in the order the usage block does", () => {
    assert.deepEqual(
        missingRequired({ pkgPath: "", keyId: "", issuerId: "", p8Path: "", help: false }),
        [".pkg path (-f)", "KEY_ID (-k)", "ISSUER_ID (-i)", ".p8 path (-p)"],
    );
    assert.deepEqual(missingRequired({ ...COMPLETE, issuerId: "" }), ["ISSUER_ID (-i)"]);
    assert.deepEqual(missingRequired(COMPLETE), []);
});

test("isFlatPackage accepts only the installer the store wants", () => {
    assert.equal(isFlatPackage("build/App.pkg"), true);
    assert.equal(isFlatPackage("build/App.app"), false);
    assert.equal(isFlatPackage("build/App.dmg"), false);
    assert.equal(isFlatPackage("build/App.pkg.zip"), false);
});

test("altoolKeyPath spells the one filename altool will search for", () => {
    assert.equal(
        altoolKeyPath("/Users/someone", "ABC123"),
        "/Users/someone/.appstoreconnect/private_keys/AuthKey_ABC123.p8",
    );
});

test("absolutePath matches the shell's dirname/pwd/basename dance", () => {
    assert.equal(absolutePath("key.p8", "/work"), "/work/key.p8");
    assert.equal(absolutePath("./keys/key.p8", "/work"), "/work/keys/key.p8");
    assert.equal(absolutePath("../key.p8", "/work/sub"), "/work/key.p8");
    assert.equal(absolutePath("/abs/key.p8", "/work"), "/abs/key.p8");
});

test("onPath finds an executable the way `command -v` does", () => {
    const dir = mkdtempSync(join(tmpdir(), "appkit-packaging-path."));
    const other = mkdtempSync(join(tmpdir(), "appkit-packaging-path."));
    writeFileSync(join(dir, "pretend-xcrun"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "pretend-xcrun"), 0o755);
    writeFileSync(join(dir, "not-executable"), "");

    assert.equal(onPath("pretend-xcrun", `${other}:${dir}`), true);
    assert.equal(onPath("pretend-xcrun", other), false);
    assert.equal(onPath("not-executable", dir), false);
    assert.equal(onPath("pretend-xcrun", undefined), false);
    assert.equal(onPath("pretend-xcrun", ""), false);
});
