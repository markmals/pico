import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
    bundledInputDirectories,
    bundledPackageRoots,
    collectPackageNotices,
    noticesDriftProblem,
    NOTICES_PREAMBLE,
    renderNotices,
} from "./third-party-notices.ts";

// The shape `Bun.build` reports: input keys relative to the directory the build ran in.
const METAFILE = {
    inputs: {
        "adapter/pico.ts": { bytes: 1, imports: [] },
        "adapter/main.ts": { bytes: 1, imports: [] },
        "node_modules/left-pad/index.js": { bytes: 1, imports: [] },
        "node_modules/left-pad/lib/helper.js": { bytes: 1, imports: [] },
        "node_modules/@scope/widget/src/index.ts": { bytes: 1, imports: [] },
        "node_modules/left-pad/node_modules/nested-dep/index.js": { bytes: 1, imports: [] },
    },
    outputs: {},
};

function fixturePackages(t: TestContext): string {
    let root = mkdtempSync(path.join(tmpdir(), "pico-notices-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function writePackage(
    root: string,
    name: string,
    manifest: Record<string, unknown>,
    licenseFiles: Record<string, string> = {},
): string {
    let dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, ...manifest }));
    for (let [file, text] of Object.entries(licenseFiles)) {
        let target = path.join(dir, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, text);
    }
    return dir;
}

test("proposal.0002 every bundled input under node_modules names its package root", () => {
    let roots = bundledPackageRoots(Object.keys(METAFILE.inputs), "/repo");
    assert.deepEqual(roots, [
        "/repo/node_modules/@scope/widget",
        "/repo/node_modules/left-pad",
        "/repo/node_modules/left-pad/node_modules/nested-dep",
    ]);
});

test("proposal.0002 inputs outside node_modules contribute no package", () => {
    assert.deepEqual(bundledPackageRoots(["adapter/main.ts", "tools/build-pico.ts"], "/repo"), []);
});

test("proposal.0002 every bundled input names the directory it came from", () => {
    assert.deepEqual([...bundledInputDirectories(Object.keys(METAFILE.inputs), "/repo")].sort(), [
        ["/repo/node_modules/@scope/widget", ["/repo/node_modules/@scope/widget/src"]],
        [
            "/repo/node_modules/left-pad",
            ["/repo/node_modules/left-pad", "/repo/node_modules/left-pad/lib"],
        ],
        [
            "/repo/node_modules/left-pad/node_modules/nested-dep",
            ["/repo/node_modules/left-pad/node_modules/nested-dep"],
        ],
    ]);
});

test("proposal.0002 a package's notice carries its name, version, license and license text", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "left-pad",
        { version: "1.3.0", license: "WTFPL" },
        { LICENSE: "DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE\n" },
    );
    let notices = await collectPackageNotices([dir]);
    assert.deepEqual(notices, [
        {
            name: "left-pad",
            version: "1.3.0",
            license: "WTFPL",
            licenseText: "DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE",
        },
    ]);
});

// hk's whitespace step and Oxfmt both strip trailing whitespace from the committed file. A
// license reproduced with its own trailing spaces would be rewritten the moment the gate ran,
// and every later build would then report drift against a file nobody had touched.
test("proposal.0002 license text carries no trailing whitespace", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "spacey",
        { version: "1.0.0", license: "MIT" },
        { LICENSE: "line one   \n\t\nline two\t\n   \n" },
    );
    assert.equal((await collectPackageNotices([dir]))[0]?.licenseText, "line one\n\nline two");
});

test("proposal.0002 LICENSE.md, LICENCE and COPYING all count as license files", async t => {
    let root = fixturePackages(t);
    let dirs = [
        writePackage(root, "a", { version: "1.0.0", license: "MIT" }, { "LICENSE.md": "a text\n" }),
        writePackage(root, "b", { version: "2.0.0", license: "ISC" }, { LICENCE: "b text\n" }),
        writePackage(
            root,
            "c",
            { version: "3.0.0", license: "Apache-2.0" },
            { COPYING: "c text\n" },
        ),
    ];
    let notices = await collectPackageNotices(dirs);
    assert.deepEqual(
        notices.map(notice => `${notice.name} ${notice.licenseText}`),
        ["a a text", "b b text", "c c text"],
    );
});

test("proposal.0002 notices are sorted by package name", async t => {
    let root = fixturePackages(t);
    let dirs = [
        writePackage(root, "zebra", { version: "1.0.0", license: "MIT" }, { LICENSE: "z\n" }),
        writePackage(root, "alpha", { version: "1.0.0", license: "MIT" }, { LICENSE: "a\n" }),
    ];
    assert.deepEqual(
        (await collectPackageNotices(dirs)).map(notice => notice.name),
        ["alpha", "zebra"],
    );
});

test("proposal.0002 two installed copies of one package version make one section", async t => {
    let root = fixturePackages(t);
    // The same package installed three times, as a dependency tree does when two dependents
    // need different versions: one section per version, not one per copy on disk.
    let dirs = [
        writePackage(root, "dep", { version: "2.12.0", license: "MIT" }, { LICENSE: "text\n" }),
        writePackage(
            path.join(root, "holder"),
            "dep",
            { version: "2.12.0", license: "MIT" },
            {
                LICENSE: "text\n",
            },
        ),
        writePackage(
            path.join(root, "older"),
            "dep",
            { version: "2.9.0", license: "MIT" },
            {
                LICENSE: "older\n",
            },
        ),
    ];
    assert.deepEqual(
        (await collectPackageNotices(dirs)).map(notice => `${notice.name} ${notice.version}`),
        ["dep 2.12.0", "dep 2.9.0"],
    );
});

test("proposal.0002 a package with no license file fails the build and is named", async t => {
    let root = fixturePackages(t);
    let dirs = [
        writePackage(root, "licensed", { version: "1.0.0", license: "MIT" }, { LICENSE: "ok\n" }),
        writePackage(root, "bare", { version: "4.5.6", license: "MIT" }),
        writePackage(root, "also-bare", { version: "0.1.0", license: "MIT" }),
    ];
    await assert.rejects(
        () => collectPackageNotices(dirs),
        (error: Error) => {
            assert.match(error.message, /also-bare 0\.1\.0/);
            assert.match(error.message, /bare 4\.5\.6/);
            assert.ok(!/licensed/.test(error.message), "a package with a license is not reported");
            return true;
        },
    );
});

test("proposal.0002 an override carries the license of a package that ships none", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(root, "bare", { version: "4.5.6", license: "Apache-2.0" });
    let file = path.join(root, "vendored-license.txt");
    writeFileSync(file, "Apache License, Version 2.0\n");
    let notices = await collectPackageNotices(
        [dir],
        [{ name: "bare", version: "4.5.6", file, sourceUrl: "https://example.invalid/LICENSE" }],
    );
    assert.deepEqual(notices, [
        {
            name: "bare",
            version: "4.5.6",
            license: "Apache-2.0",
            licenseText: "Apache License, Version 2.0",
            licenseTextSource: "https://example.invalid/LICENSE",
        },
    ]);
});

test("proposal.0002 an override for a package that has a license file fails", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "licensed",
        { version: "1.0.0", license: "MIT" },
        { LICENSE: "real\n" },
    );
    let file = path.join(root, "vendored-license.txt");
    writeFileSync(file, "stale copy\n");
    await assert.rejects(
        () =>
            collectPackageNotices(
                [dir],
                [
                    {
                        name: "licensed",
                        version: "1.0.0",
                        file,
                        sourceUrl: "https://example.invalid/LICENSE",
                    },
                ],
            ),
        (error: Error) => {
            assert.match(error.message, /licensed 1\.0\.0/);
            assert.match(error.message, /ships its own license file/);
            return true;
        },
    );
});

test("proposal.0002 an override is pinned to the version it was read for", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(root, "bare", { version: "4.5.7", license: "Apache-2.0" });
    let file = path.join(root, "vendored-license.txt");
    writeFileSync(file, "Apache License, Version 2.0\n");
    await assert.rejects(
        () =>
            collectPackageNotices(
                [dir],
                [
                    {
                        name: "bare",
                        version: "4.5.6",
                        file,
                        sourceUrl: "https://example.invalid/LICENSE",
                    },
                ],
            ),
        (error: Error) => {
            assert.match(error.message, /bare 4\.5\.7/);
            return true;
        },
    );
});

// axe-core's vendored dependencies and oh-my-pi's Playwright-derived code are licensed only in
// these files. A package that ships one is reproducing terms, not documentation.
test("proposal.0002 a package's further notice files are collected with its license", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "noticed",
        { version: "18.14.0", license: "MIT" },
        {
            LICENSE: "MIT text\n",
            "THIRD-PARTY-NOTICES.txt": "crate notices\n",
            NOTICE: "apache notice\n",
            "LICENSE-3RD-PARTY.txt": "vendored deps\n",
            "README.md": "not a notice\n",
        },
    );
    assert.deepEqual((await collectPackageNotices([dir]))[0]?.extraNotices, [
        { file: "LICENSE-3RD-PARTY.txt", text: "vendored deps" },
        { file: "NOTICE", text: "apache notice" },
        { file: "THIRD-PARTY-NOTICES.txt", text: "crate notices" },
    ]);
});

// `@oh-my-pi/pi-coding-agent/src/markit/NOTICE` attributes markit-ai, and it licenses code the
// binary bundles from that directory. A notice beside the code is still a notice.
test("proposal.0002 notice files beside a bundled input are collected too", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "deep",
        { version: "1.0.0", license: "MIT" },
        {
            LICENSE: "MIT text\n",
            NOTICE: "root notice\n",
            "src/markit/NOTICE": "markit notice\n",
            "src/unused/NOTICE": "nothing bundled here\n",
        },
    );
    let directories = new Map([[dir, [path.join(dir, "src", "markit")]]]);
    assert.deepEqual((await collectPackageNotices([dir], [], directories))[0]?.extraNotices, [
        { file: "NOTICE", text: "root notice" },
        { file: path.join("src", "markit", "NOTICE"), text: "markit notice" },
    ]);
});

test("proposal.0002 a nested notice is collected once however many inputs sit beside it", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "deep",
        { version: "1.0.0", license: "MIT" },
        {
            LICENSE: "MIT text\n",
            "src/markit/NOTICE": "markit notice\n",
            "src/markit/html/README.md": "a bundled input's directory\n",
        },
    );
    let directories = new Map([
        [dir, [path.join(dir, "src", "markit"), path.join(dir, "src", "markit", "html")]],
    ]);
    assert.deepEqual(
        (await collectPackageNotices([dir], [], directories))[0]?.extraNotices?.map(
            notice => notice.file,
        ),
        [path.join("src", "markit", "NOTICE")],
    );
});

test("proposal.0002 a further notice file is never mistaken for the license itself", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "axe-like",
        { version: "1.0.0", license: "MPL-2.0" },
        { LICENSE: "the real license\n", "LICENSE-3RD-PARTY.txt": "vendored deps\n" },
    );
    assert.equal((await collectPackageNotices([dir]))[0]?.licenseText, "the real license");
});

test("proposal.0002 a package that ships only a notice file still needs a license", async t => {
    let root = fixturePackages(t);
    let dir = writePackage(
        root,
        "noticed-only",
        { version: "1.0.0", license: "MIT" },
        {
            NOTICE: "apache notice\n",
        },
    );
    await assert.rejects(
        () => collectPackageNotices([dir]),
        (error: Error) => {
            assert.match(error.message, /noticed-only 1\.0\.0/);
            return true;
        },
    );
});

test("proposal.0002 the rendered file keeps the committed preamble verbatim", () => {
    let rendered = renderNotices([]);
    assert.ok(
        rendered.startsWith(NOTICES_PREAMBLE),
        "the paragraph attributing the derived adapter/ modules must survive regeneration",
    );
    assert.match(
        NOTICES_PREAMBLE,
        /Pico's ACP adapter modules under `adapter\/` are derived from oh-my-pi 18\.14\.0/,
    );
});

test("proposal.0002 each package gets a section with its license in a text fence", () => {
    let rendered = renderNotices([
        { name: "alpha", version: "1.0.0", license: "MIT", licenseText: "alpha license" },
        { name: "beta", version: "2.0.0", license: "ISC", licenseText: "beta license" },
    ]);
    assert.match(rendered, /## alpha\n/);
    assert.match(rendered, /Version 1\.0\.0 — MIT/);
    assert.match(rendered, /```text\nalpha license\n```/);
    assert.ok(
        rendered.indexOf("## alpha") < rendered.indexOf("## beta"),
        "sections keep the order they are given",
    );
    assert.ok(rendered.endsWith("\n"), "the file ends with a newline");
});

test("proposal.0002 an overridden license names where its text came from", () => {
    let rendered = renderNotices([
        {
            name: "bare",
            version: "4.5.6",
            license: "Apache-2.0",
            licenseText: "Apache License, Version 2.0",
            licenseTextSource: "https://example.invalid/LICENSE",
        },
    ]);
    assert.match(rendered, /ships no license file/);
    assert.match(rendered, /<https:\/\/example\.invalid\/LICENSE>/);
    assert.match(rendered, /```text\nApache License, Version 2\.0\n```/);
});

test("proposal.0002 rendering is deterministic and carries no timestamp", () => {
    let notices = [{ name: "alpha", version: "1.0.0", license: "MIT", licenseText: "text" }];
    assert.equal(renderNotices(notices), renderNotices(notices));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(renderNotices(notices)));
});

test("proposal.0002 each further notice file is rendered in its own named fence", () => {
    let rendered = renderNotices([
        {
            name: "native",
            version: "1.0.0",
            license: "MIT",
            licenseText: "MIT text",
            extraNotices: [
                { file: "NOTICE", text: "apache notice" },
                { file: "THIRD-PARTY-NOTICES.txt", text: "crate notices" },
            ],
        },
    ]);
    assert.match(rendered, /```text\nMIT text\n```/);
    assert.match(rendered, /`NOTICE`/);
    assert.match(rendered, /```text\napache notice\n```/);
    assert.match(rendered, /`THIRD-PARTY-NOTICES\.txt`/);
    assert.match(rendered, /```text\ncrate notices\n```/);
    assert.ok(
        rendered.indexOf("apache notice") < rendered.indexOf("crate notices"),
        "the fences keep the order they are given",
    );
});

test("proposal.0002 matching notices are no drift", () => {
    assert.equal(noticesDriftProblem("same\n", "same\n"), null);
});

test("proposal.0002 differing notices fail and name the flag that fixes them", () => {
    let problem = noticesDriftProblem("fresh\n", "stale\n");
    assert.ok(problem !== null, "a dependency change must not ship stale notices");
    assert.match(problem, /--write-notices/);
    assert.match(problem, /THIRD-PARTY-NOTICES\.md/);
});

test("proposal.0002 a missing committed file is drift", () => {
    let problem = noticesDriftProblem("fresh\n", null);
    assert.ok(problem !== null, "nothing committed is as stale as the wrong thing committed");
    assert.match(problem, /--write-notices/);
});
