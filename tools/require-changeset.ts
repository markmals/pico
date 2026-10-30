// Every pull request adds a changeset. The release pull request consumes changesets
// instead of adding one, so the workflow exempts it before calling this.

import { execFileSync } from "node:child_process";

/// `.changeset/README.md` is documentation, not a changeset.
export function changesetFiles(paths: readonly string[]): string[] {
    return paths.filter(
        path =>
            path.startsWith(".changeset/") && path.endsWith(".md") && !path.endsWith("/README.md"),
    );
}

if (import.meta.main) {
    let [baseSha, headSha] = process.argv.slice(2);

    if (!baseSha || !headSha) {
        console.error("usage: bun tools/require-changeset.ts <base-sha> <head-sha>");
        process.exit(2);
    }

    let added = changesetFiles(
        execFileSync(
            "git",
            ["diff", "--name-only", "--diff-filter=A", baseSha, headSha, "--", ".changeset"],
            {
                encoding: "utf8",
            },
        ).split("\n"),
    );

    if (added.length === 0) {
        console.error(
            "::error::Every pull request adds a changeset. Run 'mise run changeset', or 'mise run changeset -- --empty' when nothing releasable changed.",
        );
        process.exit(1);
    }

    console.log(`Found ${added.length} new changeset(s): ${added.join(", ")}`);
    // `run --bun` rather than `x`: it takes the changeset already in node_modules
    // and runs it on Bun, where `bun x` would fall back to installing one and
    // node_modules/.bin/changeset is a `#!/usr/bin/env node` shim.
    execFileSync("bun", ["run", "--bun", "changeset", "status", `--since=${baseSha}`], {
        stdio: "inherit",
    });
}
