/**
 * Create a SwiftUI design prototype from the skill's template.
 *
 *   bun .agents/skills/prototyping-apple-app-design/scripts/new-prototype.ts "Reading Tracker" ~/Prototypes/reading-tracker
 *
 * Produces an Xcode project that builds for iPhone, iPad, Mac, and Vision Pro out of
 * the box. Source folders are file-system synchronized, so new .swift files are picked
 * up with no project-file editing.
 */

import { cpSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { type OptionConfig, die, rejectArgs, runMain } from "./lib/cli.ts";

const OPTIONS = {
    watch: { type: "boolean" },
} as const satisfies Record<string, OptionConfig>;

const GITIGNORE = `.DS_Store
.build/
.shots/
build/
DerivedData/
*.xcuserdatad
`;

/**
 * Lower-case, with every run of non-alphanumerics collapsed to one dash and a trailing
 * dash trimmed — the shell version's `tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'`.
 */
export function slugify(displayName: string): string {
    return displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-$/, "");
}

function main(): void {
    const args = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: true });
    } catch (error) {
        rejectArgs(error, args, OPTIONS, true);
    }

    const positional = parsed.positionals;
    const displayName = positional[0];
    if (displayName === undefined) {
        die(
            64,
            'usage: bun .agents/skills/prototyping-apple-app-design/scripts/new-prototype.ts [--watch] "Display Name" [destination-dir]',
        );
    }

    const withWatch = parsed.values.watch === true;
    const slug = slugify(displayName);
    const destination = path.resolve(positional[1] ?? path.join(process.cwd(), slug));
    const skillDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    // `lstat`, not `exists`: a dangling symlink at the destination is still something
    // that would have to be overwritten.
    if (lstatSync(destination, { throwIfNoEntry: false }) !== undefined) {
        die(73, `error: ${destination} already exists`);
    }

    cpSync(path.join(skillDirectory, "template"), destination, { recursive: true });

    // A watchOS app has to be its own target, so the project file differs. Both variants
    // are checked in and verified rather than being patched together at run time.
    if (withWatch) {
        renameSync(
            path.join(destination, ".watch/project.pbxproj"),
            path.join(destination, "Prototype.xcodeproj/project.pbxproj"),
        );
    } else {
        rmSync(path.join(destination, "Watch"), { recursive: true, force: true });
    }
    rmSync(path.join(destination, ".watch"), { recursive: true, force: true });

    const pbxprojPath = path.join(destination, "Prototype.xcodeproj/project.pbxproj");
    const pbxproj = readFileSync(pbxprojPath, "utf8");
    // `split`/`join` rather than `replaceAll`: a display name containing `$&` or `$1`
    // would otherwise be treated as a replacement pattern.
    writeFileSync(
        pbxprojPath,
        pbxproj
            .split("com.prototype.template")
            .join(`com.prototype.${slug}`)
            .split("Prototype Template")
            .join(displayName),
    );

    writeFileSync(path.join(destination, ".gitignore"), GITIGNORE);

    console.log(`Created ${destination}`);
    console.log("");
    console.log(`  Open in Xcode:  open '${destination}/Prototype.xcodeproj'`);
    console.log("  Capture a screen:");
    console.log(`    bun '${skillDirectory}/scripts/shoot.ts' --project '${destination}' --all`);
    console.log("");
    console.log("Next: replace the Note* domain in Shared/Backend and Shared/Features");
    console.log("with the real subject, and register each screen in ScreenCatalog.swift.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runMain(main);
}
