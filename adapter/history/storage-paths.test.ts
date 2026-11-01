import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { SessionStoreError } from "./errors.ts";
import { canonicalDirectory, requireProject } from "./storage-paths.ts";

describe("proposal.0004 project admission", () => {
    test("an existing directory without search permission is rejected as an unusable project", () => {
        const directory = fs.realpathSync(
            fs.mkdtempSync(path.join(os.tmpdir(), "pico-project-access-")),
        );
        try {
            fs.chmodSync(directory, 0o600);
            assert.throws(
                () => requireProject(directory),
                (error: unknown) =>
                    error instanceof SessionStoreError &&
                    error.kind === "invalid" &&
                    error.message.includes(directory),
            );
        } finally {
            fs.chmodSync(directory, 0o700);
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test("a removed project keeps the same canonical filter through a surviving parent alias", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pico-project-alias-")));
        const real = path.join(root, "real");
        const alias = path.join(root, "alias");
        const project = path.join(real, "removed-project");
        try {
            fs.mkdirSync(project, { recursive: true });
            fs.symlinkSync(real, alias, "dir");
            const original = fs.realpathSync(path.join(alias, "removed-project"));
            fs.rmdirSync(project);
            assert.equal(canonicalDirectory(path.join(alias, "removed-project")), original);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
