import assert from "node:assert/strict";
import { test } from "node:test";

import { appleVersion, setMarketingVersion, versionFrom } from "./sync-version.ts";

test("versionFrom rejects a package.json without a usable version", () => {
    assert.throws(() => versionFrom("{}"));
    assert.throws(() => versionFrom('{"version":""}'));
    assert.throws(() => versionFrom('{"version":1}'));
});

test("appleVersion keeps a plain semver version", () => {
    assert.equal(appleVersion("1.2.3"), "1.2.3");
    assert.equal(appleVersion("0.1"), "0.1");
    assert.equal(appleVersion("12"), "12");
});

test("appleVersion drops prerelease and build metadata", () => {
    assert.equal(appleVersion("1.2.0-next.3"), "1.2.0");
    assert.equal(appleVersion("1.2.0+20260101"), "1.2.0");
});

test("appleVersion rejects what Apple would reject", () => {
    assert.throws(() => appleVersion("1.2.3.4"), Error);
    assert.throws(() => appleVersion("v1.2.3"), Error);
    assert.throws(() => appleVersion(""), Error);
});

test("setMarketingVersion fails loudly when the assignment is gone", () => {
    assert.throws(() => setMarketingVersion("CURRENT_PROJECT_VERSION = 1\n", "1.0.0"), Error);
});
