import assert from "node:assert/strict";
import { test } from "node:test";

import { machOArchitecture } from "./build-keychain.ts";

test("proposal.0009 the addon is built for the Mac that runs it", () => {
    assert.equal(machOArchitecture("arm64"), "arm64");
    assert.equal(machOArchitecture("x64"), "x86_64");
    assert.throws(() => machOArchitecture("arm"), /arm/);
});
