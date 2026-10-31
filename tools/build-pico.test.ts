import assert from "node:assert/strict";
import { test } from "node:test";

import { bunVersionProblem, pinnedBunVersion } from "./build-pico.ts";

// A mise.toml shaped like this repository's: the pin lives in `[tools]`, and other
// tables mention Bun too, so a naive search for `bun =` would read the wrong line.
const MISE_TOML = `#:schema https://mise.jdx.dev/schema/mise.json

[settings]
lockfile = true

[tools]
bun = "1.4.4"
hk = "2.8.1"

[tasks."deps:install"]
run = "bun install --frozen-lockfile"
`;

test("proposal.0002 the pinned Bun is the [tools] table's bun key", () => {
    assert.equal(pinnedBunVersion(MISE_TOML), "1.4.4");
});

test("proposal.0002 a bun key outside [tools] is not the pin", () => {
    assert.equal(pinnedBunVersion(`[tasks.build]\nbun = "9.9.9"\n`), null);
});

test("proposal.0002 a mise.toml with no Bun pin has none", () => {
    assert.equal(pinnedBunVersion(`[tools]\nhk = "2.8.1"\n`), null);
});

test("proposal.0002 the running Bun builds when its major and minor match the pin", () => {
    assert.equal(bunVersionProblem("1.4.4", MISE_TOML), null);
});

test("proposal.0002 a patch difference still builds", () => {
    assert.equal(bunVersionProblem("1.4.9", MISE_TOML), null);
});

test("proposal.0002 a newer minor version fails, naming both versions", () => {
    let problem = bunVersionProblem("1.5.0", MISE_TOML);
    assert.ok(problem !== null, "a Bun with a different minor version must not build pico");
    assert.match(problem, /1\.5\.0/);
    assert.match(problem, /1\.4\.4/);
});

test("proposal.0002 an older major version fails, naming both versions", () => {
    let problem = bunVersionProblem("0.8.1", MISE_TOML);
    assert.ok(problem !== null, "a Bun with a different major version must not build pico");
    assert.match(problem, /0\.8\.1/);
    assert.match(problem, /1\.4\.4/);
});

test("proposal.0002 a mise.toml without a Bun pin fails the check", () => {
    let problem = bunVersionProblem("1.4.4", `[tools]\nhk = "2.8.1"\n`);
    assert.ok(problem !== null, "with nothing pinned there is no tested Bun to compare against");
    assert.match(problem, /mise\.toml/);
});

test("proposal.0002 a Bun version with a prerelease suffix compares by major and minor", () => {
    assert.equal(bunVersionProblem("1.4.4-canary.20260101", MISE_TOML), null);
});
