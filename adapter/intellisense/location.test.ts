import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveIntellisense } from "./location.ts";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-intellisense-")));
    roots.push(root);
    return root;
}

/** A directory under a fresh root, created with the entries the test needs inside it. */
function directory(root: string, name: string): string {
    const made = path.join(root, name);
    mkdirSync(made, { recursive: true });
    return made;
}

function executable(file: string): string {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "#!/bin/sh\necho 'intellisense 0.2.0'\n", { mode: 0o755 });
    return file;
}

describe("pico-bfk.20 a saved intellisense path", () => {
    test("a regular executable file is the location, kept exactly as it was saved", () => {
        const root = temporaryRoot();
        const saved = executable(path.join(root, "tools", "intellisense"));

        expect(resolveIntellisense(saved, { path: undefined, home: root })).toEqual({
            status: "found",
            source: "settings",
            path: saved,
        });
    });

    test("a symlink to an executable is usable, and the link is not resolved", () => {
        const root = temporaryRoot();
        const target = executable(path.join(root, "cellar", "intellisense"));
        const link = path.join(directory(root, "bin"), "intellisense");
        symlinkSync(target, link);

        expect(resolveIntellisense(link, { path: undefined, home: root })).toEqual({
            status: "found",
            source: "settings",
            path: link,
        });
    });

    test("nothing there is unusable, and never falls back to discovery", () => {
        const root = temporaryRoot();
        executable(path.join(root, "bin", "intellisense"));
        const saved = path.join(root, "gone", "intellisense");

        expect(resolveIntellisense(saved, { path: path.join(root, "bin"), home: root })).toEqual({
            status: "unusable",
            source: "settings",
            path: saved,
            problem: `${saved} does not exist`,
        });
    });

    test("a dangling symlink does not exist either", () => {
        const root = temporaryRoot();
        const link = path.join(directory(root, "bin"), "intellisense");
        symlinkSync(path.join(root, "never-written"), link);

        expect(resolveIntellisense(link, { path: undefined, home: root })).toEqual({
            status: "unusable",
            source: "settings",
            path: link,
            problem: `${link} does not exist`,
        });
    });

    test("a directory is not a regular file", () => {
        const root = temporaryRoot();
        const saved = directory(root, "intellisense");

        expect(resolveIntellisense(saved, { path: undefined, home: root })).toEqual({
            status: "unusable",
            source: "settings",
            path: saved,
            problem: `${saved} is not a regular file`,
        });
    });

    test("a file without the executable bit is not executable", () => {
        const root = temporaryRoot();
        const saved = path.join(directory(root, "bin"), "intellisense");
        writeFileSync(saved, "#!/bin/sh\n", { mode: 0o644 });

        expect(resolveIntellisense(saved, { path: undefined, home: root })).toEqual({
            status: "unusable",
            source: "settings",
            path: saved,
            problem: `${saved} is not executable`,
        });
    });
});

describe("pico-bfk.20 discovering intellisense with nothing saved", () => {
    test("the first usable file on PATH wins, in PATH's own order", () => {
        const root = temporaryRoot();
        const first = directory(root, "first");
        const second = executable(path.join(root, "second", "intellisense"));
        executable(path.join(root, "third", "intellisense"));

        const location = resolveIntellisense(null, {
            path: [first, path.dirname(second), path.join(root, "third")].join(path.delimiter),
            home: root,
        });

        expect(location).toEqual({ status: "found", source: "discovered", path: second });
    });

    test("a file on PATH that cannot be run is passed over", () => {
        const root = temporaryRoot();
        const unusable = path.join(directory(root, "first"), "intellisense");
        writeFileSync(unusable, "#!/bin/sh\n", { mode: 0o644 });
        const usable = executable(path.join(root, "second", "intellisense"));

        const location = resolveIntellisense(null, {
            path: [path.dirname(unusable), path.dirname(usable)].join(path.delimiter),
            home: root,
        });

        expect(location).toEqual({ status: "found", source: "discovered", path: usable });
    });

    test("the home install directories are searched after PATH, cargo before local", () => {
        const root = temporaryRoot();
        const home = directory(root, "home");
        const local = executable(path.join(home, ".local", "bin", "intellisense"));

        expect(resolveIntellisense(null, { path: directory(root, "empty"), home })).toEqual({
            status: "found",
            source: "discovered",
            path: local,
        });

        const cargo = executable(path.join(home, ".cargo", "bin", "intellisense"));

        expect(resolveIntellisense(null, { path: directory(root, "empty"), home })).toEqual({
            status: "found",
            source: "discovered",
            path: cargo,
        });
    });

    test("nothing anywhere is missing, naming every directory it searched once", () => {
        const root = temporaryRoot();
        const home = directory(root, "home");
        const bin = directory(root, "bin");

        const location = resolveIntellisense(null, {
            path: [bin, "", bin].join(path.delimiter),
            home,
        });

        const searched = [
            bin,
            path.join(home, ".cargo", "bin"),
            path.join(home, ".local", "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ];
        expect(location).toEqual({
            status: "missing",
            source: "discovered",
            path: null,
            searched,
            problem: `No intellisense executable in ${searched.join(", ")}`,
        });
    });

    test("a PATH directory that is also an install directory is searched once", () => {
        const root = temporaryRoot();
        const home = directory(root, "home");
        const cargo = path.join(home, ".cargo", "bin");
        mkdirSync(cargo, { recursive: true });

        const location = resolveIntellisense(null, { path: cargo, home });

        expect(location).toEqual({
            status: "missing",
            source: "discovered",
            path: null,
            searched: [
                cargo,
                path.join(home, ".local", "bin"),
                "/opt/homebrew/bin",
                "/usr/local/bin",
            ],
            problem: expect.any(String) as unknown as string,
        });
    });

    test("without a home directory, only PATH and the system directories are searched", () => {
        const root = temporaryRoot();
        const bin = directory(root, "bin");

        const location = resolveIntellisense(null, { path: bin, home: undefined });

        expect(location).toEqual({
            status: "missing",
            source: "discovered",
            path: null,
            searched: [bin, "/opt/homebrew/bin", "/usr/local/bin"],
            problem: expect.any(String) as unknown as string,
        });
    });
});
