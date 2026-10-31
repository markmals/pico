import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { collectBundledPiEntries, renderLegacyPiVirtualModule } from "./legacy-pi-modules.ts";

// A node_modules tree holding only what the generator reads, so these tests say what the
// generator does with an `exports` map rather than what oh-my-pi happens to publish today.
function fixtureNodeModules(t: TestContext): string {
    let root = mkdtempSync(path.join(tmpdir(), "pico-legacy-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    let nodeModules = path.join(root, "node_modules");

    function writePackage(name: string, exportsField: Record<string, unknown>): void {
        let dir = path.join(nodeModules, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name, version: "18.14.0", exports: exportsField }),
        );
    }

    function writeSource(name: string, relative: string): void {
        let file = path.join(nodeModules, name, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "export {};\n");
    }

    writePackage("@oh-my-pi/pi-agent-core", {
        ".": { import: "./src/index.ts" },
        "./compaction": { import: "./src/compaction/index.ts" },
        "./compaction/*": { import: "./src/compaction/*.ts" },
        "./*": { import: "./src/*.ts" },
    });
    for (let file of [
        "src/compaction/strategy.ts",
        "src/compaction/nested/deep.ts",
        "src/compaction/_private.ts",
        "src/compaction/.hidden.ts",
        "src/compaction/strategy.test.ts",
        "src/compaction/worker-entry.ts",
        "src/compaction/_skipped/visible.ts",
        "src/root-level.ts",
    ]) {
        writeSource("@oh-my-pi/pi-agent-core", file);
    }

    writePackage("@oh-my-pi/pi-ai", { ".": { import: "./src/index.ts" } });
    writePackage("@oh-my-pi/pi-catalog", {
        ".": { import: "./src/index.ts" },
        "./*": { import: "./src/*.ts" },
    });
    for (let file of ["src/top.ts", "src/deep/inner.ts"]) writeSource("@oh-my-pi/pi-catalog", file);

    writePackage("@oh-my-pi/pi-coding-agent", {
        ".": { import: "./src/index.ts" },
        "./*": { import: "./src/*.ts" },
    });
    for (let file of ["src/cli.ts", "src/main.ts", "src/sdk.ts", "src/tools/bash.ts"])
        writeSource("@oh-my-pi/pi-coding-agent", file);

    writePackage("@oh-my-pi/pi-natives", {
        ".": {
            types: "./native/index.d.ts",
            import: "./native/index.js",
            default: "./native/index.js",
        },
        "./THIRD-PARTY-NOTICES.txt": "./THIRD-PARTY-NOTICES.txt",
        "./path": { import: "./native/path.js" },
    });

    writePackage("@oh-my-pi/pi-tui", {
        ".": { import: "./src/index.ts" },
        "./*": { import: "./src/*.ts" },
    });
    for (let file of ["src/colors.ts", "src/components/box.ts"])
        writeSource("@oh-my-pi/pi-tui", file);

    writePackage("@oh-my-pi/pi-utils", {
        ".": { import: "./src/index.ts" },
        "./ar": { import: "./src/ar/index.ts" },
        "./*": { import: "./src/*.ts" },
        "./*.js": "./src/*.ts",
    });
    writeSource("@oh-my-pi/pi-utils", "src/dirs.ts");

    return nodeModules;
}

function keysOf(entries: readonly { key: string }[]): Set<string> {
    return new Set(entries.map(entry => entry.key));
}

test("proposal.0002 every bundled package's root is a key", async t => {
    let entries = await collectBundledPiEntries(fixtureNodeModules(t));
    let keys = keysOf(entries);
    for (let name of [
        "@oh-my-pi/pi-agent-core",
        "@oh-my-pi/pi-ai",
        "@oh-my-pi/pi-catalog",
        "@oh-my-pi/pi-coding-agent",
        "@oh-my-pi/pi-natives",
        "@oh-my-pi/pi-tui",
        "@oh-my-pi/pi-utils",
    ]) {
        assert.ok(keys.has(name), `${name} must be a bundled module key`);
    }
});

test("proposal.0002 the shimmed package roots import oh-my-pi's compat modules", async t => {
    let nodeModules = fixtureNodeModules(t);
    let entries = await collectBundledPiEntries(nodeModules);
    let shimDir = path.join(nodeModules, "@oh-my-pi", "pi-coding-agent", "src", "extensibility");
    let specifierFor = (key: string) => entries.find(entry => entry.key === key)?.importSpecifier;

    assert.equal(specifierFor("@oh-my-pi/pi-ai"), path.join(shimDir, "legacy-pi-ai-shim.ts"));
    assert.equal(
        specifierFor("@oh-my-pi/pi-coding-agent"),
        path.join(shimDir, "legacy-pi-coding-agent-shim.ts"),
    );
    assert.equal(specifierFor("@oh-my-pi/pi-tui"), path.join(shimDir, "legacy-pi-tui-shim.ts"));
    assert.equal(specifierFor("typebox"), path.join(shimDir, "legacy-typebox.ts"));
});

test("proposal.0002 an unshimmed package root imports the package itself", async t => {
    let entries = await collectBundledPiEntries(fixtureNodeModules(t));
    assert.equal(
        entries.find(entry => entry.key === "@oh-my-pi/pi-utils")?.importSpecifier,
        "@oh-my-pi/pi-utils",
    );
});

test("proposal.0002 named subpath exports become keys", async t => {
    let keys = keysOf(await collectBundledPiEntries(fixtureNodeModules(t)));
    assert.ok(keys.has("@oh-my-pi/pi-agent-core/compaction"));
    assert.ok(keys.has("@oh-my-pi/pi-utils/ar"));
    assert.ok(keys.has("@oh-my-pi/pi-natives/path"));
    assert.ok(keys.has("@oh-my-pi/pi-natives/THIRD-PARTY-NOTICES.txt"));
});

test("proposal.0002 a named wildcard export expands across directories", async t => {
    let keys = keysOf(await collectBundledPiEntries(fixtureNodeModules(t)));
    assert.ok(keys.has("@oh-my-pi/pi-agent-core/compaction/strategy"));
    assert.ok(
        keys.has("@oh-my-pi/pi-agent-core/compaction/nested/deep"),
        "Node matches `*` across `/`, so nested files are exported too",
    );
});

test("proposal.0002 wildcard expansion skips private, hidden, test and worker files", async t => {
    let keys = keysOf(await collectBundledPiEntries(fixtureNodeModules(t)));
    for (let key of [
        "@oh-my-pi/pi-agent-core/compaction/_private",
        "@oh-my-pi/pi-agent-core/compaction/.hidden",
        "@oh-my-pi/pi-agent-core/compaction/strategy.test",
        "@oh-my-pi/pi-agent-core/compaction/worker-entry",
        "@oh-my-pi/pi-agent-core/compaction/_skipped/visible",
    ]) {
        assert.ok(!keys.has(key), `${key} must stay out of the registry`);
    }
});

// The binary must resolve what the source build resolves. Node matches `*` in an `exports`
// pattern across `/`, so a root `./*` serves every module under the package's source root, and
// an extension importing one of them has to find it in `pico` too.
test("proposal.0002 a root catch-all is expanded as Node resolves it", async t => {
    let keys = keysOf(await collectBundledPiEntries(fixtureNodeModules(t)));
    assert.ok(keys.has("@oh-my-pi/pi-utils/dirs"), "`@oh-my-pi/pi-utils/dirs` loads from source");
    assert.ok(keys.has("@oh-my-pi/pi-agent-core/root-level"));
    assert.ok(keys.has("@oh-my-pi/pi-catalog/top"));
    assert.ok(keys.has("@oh-my-pi/pi-catalog/deep/inner"), "`*` matches across `/`");
    assert.ok(keys.has("@oh-my-pi/pi-tui/colors"));
    assert.ok(keys.has("@oh-my-pi/pi-tui/components/box"));
    assert.ok(keys.has("@oh-my-pi/pi-coding-agent/sdk"));
    assert.ok(keys.has("@oh-my-pi/pi-coding-agent/tools/bash"));
});

// The one exception: importing either of these runs oh-my-pi's own command line, and both drag
// the binary entry's module graph into the registry.
test("proposal.0002 oh-my-pi's entry modules stay out of the registry", async t => {
    let keys = keysOf(await collectBundledPiEntries(fixtureNodeModules(t)));
    assert.ok(!keys.has("@oh-my-pi/pi-coding-agent/cli"));
    assert.ok(!keys.has("@oh-my-pi/pi-coding-agent/main"));
});

test("proposal.0002 every entry has a unique key and binding", async t => {
    let entries = await collectBundledPiEntries(fixtureNodeModules(t));
    assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length);
    assert.equal(new Set(entries.map(entry => entry.binding)).size, entries.length);
});

test("proposal.0002 the rendered module is a lazy registry of literal dynamic imports", () => {
    let source = renderLegacyPiVirtualModule([
        {
            key: "@oh-my-pi/pi-utils",
            binding: "bundledPiUtils",
            importSpecifier: "@oh-my-pi/pi-utils",
        },
        {
            key: "typebox",
            binding: "bundledTypeBoxShim",
            importSpecifier: "/shims/legacy-typebox.ts",
        },
    ]);
    assert.match(source, /const bundledPiUtils = \(\) => import\("@oh-my-pi\/pi-utils"\);/);
    assert.match(
        source,
        /const bundledTypeBoxShim = \(\) => import\("\/shims\/legacy-typebox\.ts"\);/,
    );
    assert.match(source, /export const BUNDLED_PI_MODULE_LOADERS = \{/);
    assert.match(source, /"@oh-my-pi\/pi-utils": bundledPiUtils,/);
    assert.match(source, /"typebox": bundledTypeBoxShim,/);
});
