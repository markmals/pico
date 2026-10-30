import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    FailureError,
    UsageError,
    findNestedSigningTargets,
    gatekeeperAppArgs,
    isNestedSigningTarget,
    notaryAuthArgs,
    notaryLogPath,
    parseNotarizeArgs,
    parseSubmissionOutput,
    stripAppSuffix,
    type NotarizeOptions,
} from "./notarize.ts";

const BASE: NotarizeOptions = {
    app: "/tmp/My.app",
    identity: "Developer ID Application: Someone (TEAMID1234)",
    keychainProfile: "",
    key: "",
    keyId: "",
    issuer: "",
    entitlements: "",
    makeDmg: false,
    help: false,
};

const ACCEPTED = [
    "Conducting pre-submission checks for My.zip and initiating connection to the Apple notary service...",
    "Submission ID received",
    "  id: 2efe2717-52ef-43a5-96dc-0797e4ca1041",
    "Upload progress: 100.00% (12.3 MB of 12.3 MB)",
    "Successfully uploaded file",
    "  id: 2efe2717-52ef-43a5-96dc-0797e4ca1041",
    "  path: /tmp/My.zip",
    "Waiting for processing to complete.",
    "Processing complete",
    "  id: 2efe2717-52ef-43a5-96dc-0797e4ca1041",
    "  status: Accepted",
    "",
].join("\n");

test("parseSubmissionOutput reads the submission id and the final status", () => {
    assert.deepEqual(parseSubmissionOutput(ACCEPTED), {
        id: "2efe2717-52ef-43a5-96dc-0797e4ca1041",
        status: "Accepted",
    });
});

test("parseSubmissionOutput reports a rejection so the log can be fetched", () => {
    const invalid = ACCEPTED.replace("status: Accepted", "status: Invalid");
    assert.deepEqual(parseSubmissionOutput(invalid), {
        id: "2efe2717-52ef-43a5-96dc-0797e4ca1041",
        status: "Invalid",
    });
});

test("parseSubmissionOutput returns empty strings when the submit never got that far", () => {
    const failed = [
        "Error: HTTP status code: 401. Invalid credentials.",
        "Provide a correct combination of API key and issuer.",
        "",
    ].join("\n");
    assert.deepEqual(parseSubmissionOutput(failed), { id: "", status: "" });
});

test("parseSubmissionOutput reads the id as the field after the label, whatever its case", () => {
    // awk took $2 of the first /[Ii]d:/ line, so the label has to be $1.
    const output = ["  Id: abc-123", "  status: Accepted"].join("\n");
    assert.deepEqual(parseSubmissionOutput(output), { id: "abc-123", status: "Accepted" });
});

test("parseSubmissionOutput would be fooled by the progress line --no-progress suppresses", () => {
    // Documents why the submit passes --no-progress: the spinner's trailing
    // dots end up in the status, which then never equals "Accepted".
    const withProgress = [
        "  id: abc-123",
        "Current status: In Progress.....",
        "  status: Accepted",
    ].join("\n");
    assert.equal(parseSubmissionOutput(withProgress).status, "In Progress.....");
});

test("stripAppSuffix drops only a trailing .app", () => {
    assert.equal(stripAppSuffix("/b/My.app"), "/b/My");
    assert.equal(stripAppSuffix("/b/My.apple"), "/b/My.apple");
    assert.equal(stripAppSuffix("/b/My"), "/b/My");
});

test("notaryLogPath swaps the last extension for .notary-log.json", () => {
    assert.equal(notaryLogPath("/b/My.zip"), "/b/My.notary-log.json");
    assert.equal(notaryLogPath("/b/My.dmg"), "/b/My.notary-log.json");
    assert.equal(notaryLogPath("/b/My"), "/b/My.notary-log.json");
});

test("isNestedSigningTarget matches what find looked for", () => {
    for (const name of [
        "libFoo.dylib",
        "Sparkle.framework",
        "Helper.app",
        "XPC.xpc",
        "Res.bundle",
    ]) {
        assert.equal(isNestedSigningTarget(name), true, name);
    }
    for (const name of ["Info.plist", "MyApp", "icon.png", "dylib"]) {
        assert.equal(isNestedSigningTarget(name), false, name);
    }
});

test("notaryAuthArgs prefers a stored keychain profile", () => {
    assert.deepEqual(
        notaryAuthArgs({ ...BASE, keychainProfile: "AC_NOTARY" }, () => true),
        ["--keychain-profile", "AC_NOTARY"],
    );
});

test("notaryAuthArgs refuses a profile mixed with raw key material", () => {
    assert.throws(
        () =>
            notaryAuthArgs({ ...BASE, keychainProfile: "AC_NOTARY", keyId: "ABC123" }, () => true),
        FailureError,
    );
});

test("notaryAuthArgs adds --issuer for a Team key and omits it for an Individual key", () => {
    const team = notaryAuthArgs(
        { ...BASE, key: "AuthKey.p8", keyId: "ABC123", issuer: "69a6de7f-dead-beef" },
        () => true,
    );
    assert.deepEqual(team, [
        "--key",
        "AuthKey.p8",
        "--key-id",
        "ABC123",
        "--issuer",
        "69a6de7f-dead-beef",
    ]);

    // An Individual key must NOT carry an issuer, or notarytool answers 401.
    const individual = notaryAuthArgs({ ...BASE, key: "AuthKey.p8", keyId: "ABC123" }, () => true);
    assert.deepEqual(individual, ["--key", "AuthKey.p8", "--key-id", "ABC123"]);
});

test("notaryAuthArgs rejects a missing key file and a missing auth mode", () => {
    assert.throws(
        () => notaryAuthArgs({ ...BASE, key: "nope.p8", keyId: "ABC123" }, () => false),
        FailureError,
    );
    assert.throws(() => notaryAuthArgs(BASE, () => true), UsageError);
});

test("parseNotarizeArgs falls back to env vars and lets flags win", () => {
    const env = { APP: "/env/My.app", SIGN_IDENTITY: "env identity", NOTARY_PROFILE: "AC_NOTARY" };
    const fromEnv = parseNotarizeArgs([], env);
    assert.equal(fromEnv.app, "/env/My.app");
    assert.equal(fromEnv.identity, "env identity");
    assert.equal(fromEnv.keychainProfile, "AC_NOTARY");
    assert.equal(fromEnv.makeDmg, false);

    const overridden = parseNotarizeArgs(["--app", "/flag/My.app", "--make-dmg"], env);
    assert.equal(overridden.app, "/flag/My.app");
    assert.equal(overridden.makeDmg, true);
});

test("parseNotarizeArgs treats unknown flags and stray words as usage errors", () => {
    assert.throws(() => parseNotarizeArgs(["--nope"], {}), UsageError);
    assert.throws(() => parseNotarizeArgs(["My.app"], {}), UsageError);
});

test("findNestedSigningTargets walks a bundle the way find did", () => {
    const root = mkdtempSync(join(tmpdir(), "appkit-packaging-walk."));
    const app = `${root}/My.app`;
    mkdirSync(`${app}/Contents/Frameworks/Sparkle.framework/Versions/A`, { recursive: true });
    mkdirSync(`${app}/Contents/XPCServices/Helper.xpc`, { recursive: true });
    mkdirSync(`${app}/Contents/MacOS`, { recursive: true });
    writeFileSync(`${app}/Contents/Info.plist`, "");
    writeFileSync(`${app}/Contents/MacOS/My`, "");
    writeFileSync(`${app}/Contents/Frameworks/libfoo.dylib`, "");
    writeFileSync(`${app}/Contents/Frameworks/Sparkle.framework/Versions/A/Sparkle`, "");
    symlinkSync("../libfoo.dylib", `${app}/Contents/Frameworks/Sparkle.framework/linked.dylib`);

    const targets = findNestedSigningTargets(`${app}/Contents`);
    // A symlink matching the name test is listed, as find listed it; Info.plist
    // and the main executable are not. Sibling directories come back in the
    // filesystem's order, so only the set of targets is pinned here.
    assert.deepEqual(
        [...targets].sort(),
        [
            `${app}/Contents/Frameworks/Sparkle.framework`,
            `${app}/Contents/Frameworks/Sparkle.framework/linked.dylib`,
            `${app}/Contents/Frameworks/libfoo.dylib`,
            `${app}/Contents/XPCServices/Helper.xpc`,
        ].sort(),
    );

    // Pre-order, like find's: the wrapper precedes what is nested inside it.
    assert.ok(
        targets.indexOf(`${app}/Contents/Frameworks/Sparkle.framework`) <
            targets.indexOf(`${app}/Contents/Frameworks/Sparkle.framework/linked.dylib`),
    );

    // The paths keep the caller's spelling instead of being normalised.
    assert.ok(
        findNestedSigningTargets(`${app}/./Contents`).includes(
            `${app}/./Contents/Frameworks/Sparkle.framework`,
        ),
    );
});

test("findNestedSigningTargets stays quiet when Contents is missing", () => {
    assert.deepEqual(findNestedSigningTargets("/nope/My.app/Contents"), []);
});

test("the app bundle is assessed under the execution policy", () => {
    // `spctl -a -t install -vv` rejects a valid .app outright (exit 3); only
    // `-t exec` assesses the policy a user meets when launching it.
    assert.deepEqual(gatekeeperAppArgs("/tmp/My.app"), ["-a", "-t", "exec", "-vv", "/tmp/My.app"]);
});
