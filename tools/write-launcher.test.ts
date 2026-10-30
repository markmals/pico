import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { bunPathProblem, launcherSource, writeLauncher } from "./write-launcher.ts";

let script = path.join(import.meta.dirname, "write-launcher.ts");

// The real path, because the tool resolves the checkout from its own location and macOS hands
// out temporary directories under a symlink.
function temporaryRoot(t: TestContext): string {
    let root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-write-launcher-")));
    t.after(() => rmSync(root, { force: true, recursive: true }));
    return root;
}

// A checkout holding nothing but the tool, so running it leaves this repository alone.
function temporaryCheckout(t: TestContext): { root: string; script: string } {
    let root = temporaryRoot(t);
    mkdirSync(path.join(root, "tools"));
    let copy = path.join(root, "tools", "write-launcher.ts");
    copyFileSync(script, copy);
    return { root, script: copy };
}

function runTool(toolScript: string, args: string[]): { code: number; stderr: string } {
    try {
        execFileSync(process.execPath, [toolScript, ...args], { encoding: "utf8", stdio: "pipe" });
        return { code: 0, stderr: "" };
    } catch (error) {
        let failure = error as { status: number; stderr: string };
        return { code: failure.status, stderr: failure.stderr };
    }
}

test("proposal.0001 the launcher's first line is a shebang for the given Bun", () => {
    let source = launcherSource("/opt/bun/bin/bun", "/repository/adapter/main.ts");
    assert.equal(source.split("\n")[0], "#!/opt/bun/bin/bun");
});

test("proposal.0001 the launcher names its entry module by absolute path", () => {
    let entry = "/repository with a space/adapter/main.ts";
    let source = launcherSource("/opt/bun/bin/bun", entry);
    assert.ok(source.includes(JSON.stringify(entry)), source);
});

test("proposal.0001 the pinned Bun's path must be given, absolute and free of whitespace", () => {
    assert.equal(bunPathProblem(process.execPath), null);

    for (let argument of [undefined, "", "bun", "./bun", "/Users/me/My Tools/bun"]) {
        let problem = bunPathProblem(argument);
        assert.ok(
            problem !== null && problem !== "",
            `expected ${JSON.stringify(argument)} to be refused with a message`,
        );
    }

    let whitespace = bunPathProblem("/Users/me/My Tools/bun");
    assert.ok(
        whitespace !== null && whitespace.includes("/Users/me/My Tools/bun"),
        `expected a message naming the path, got ${String(whitespace)}`,
    );
});

test("proposal.0001 the pinned Bun's path must be an executable file", t => {
    let root = temporaryRoot(t);

    assert.notEqual(bunPathProblem(path.join(root, "nowhere", "bun")), null);

    let unexecutable = path.join(root, "bun");
    writeFileSync(unexecutable, "", { mode: 0o644 });
    assert.notEqual(bunPathProblem(unexecutable), null);
});

test("proposal.0001 the written launcher is executable", t => {
    let launcher = path.join(temporaryRoot(t), ".build", "pico-acp");

    writeLauncher(launcher, launcherSource(process.execPath, "/repository/adapter/main.ts"));

    assert.equal(statSync(launcher).mode & 0o777, 0o755);
});

test("proposal.0001 a generated launcher runs its entry module with no environment", t => {
    let root = temporaryRoot(t);
    let entryDirectory = path.join(root, "a directory with spaces");
    mkdirSync(entryDirectory);
    let entry = path.join(entryDirectory, "main.ts");
    writeFileSync(entry, 'let marker: string = "pico-launcher-ran";\nconsole.log(marker);\n');

    let launcher = path.join(root, ".build", "pico-acp");
    writeLauncher(launcher, launcherSource(process.execPath, entry));

    let output = execFileSync(launcher, {
        cwd: tmpdir(),
        encoding: "utf8",
        env: {},
        stdio: "pipe",
    });

    assert.equal(output.trim(), "pico-launcher-ran");
});

test("proposal.0001 the tool writes its checkout's launcher for the Bun it is given", t => {
    let checkout = temporaryCheckout(t);

    assert.equal(runTool(checkout.script, [process.execPath]).code, 0);

    let launcher = path.join(checkout.root, ".build", "pico-acp");
    let source = readFileSync(launcher, "utf8");

    assert.equal(source.split("\n")[0], `#!${process.execPath}`);
    assert.ok(
        source.includes(JSON.stringify(path.join(checkout.root, "adapter", "main.ts"))),
        source,
    );
    assert.equal(statSync(launcher).mode & 0o777, 0o755);
});

test("proposal.0001 the tool refuses to guess which Bun to use", t => {
    let checkout = temporaryCheckout(t);

    let failure = runTool(checkout.script, []);

    assert.notEqual(failure.code, 0);
    assert.ok(
        failure.stderr.includes("Bun"),
        `expected a message about Bun, got ${failure.stderr}`,
    );
});
