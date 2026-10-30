/**
 * Verify every SF Symbol referenced in a prototype actually exists.
 *
 *   bun .agents/skills/prototyping-apple-app-design/scripts/check-symbols.ts path/to/prototype
 *
 * An invented symbol name renders as nothing at all — no crash, no warning, just a
 * hole in the layout that is easy to miss in a screenshot. Names are checked against
 * the system's own catalog, so this needs no extra tooling.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { die, runMain } from "./lib/cli.ts";

const CATALOG =
    "/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources/name_availability.plist";

// Take every string literal that follows a `systemImage:` / `systemName:` label, so
// names chosen by a ternary are checked too. Literals appearing before the label —
// a Label's title, for instance — are left alone, and anything containing uppercase
// or spaces is treated as prose rather than a symbol name.
const LABEL = /system(?:Image|Name):/;
const LITERAL = /"([^"]*)"/g;
const SYMBOL_SHAPED = /^[a-z0-9][a-z0-9.\-]*$/;

export type SymbolReference = {
    readonly file: string;
    readonly line: number;
    readonly name: string;
};

/** Symbol-shaped literals appearing after the first `systemImage:`/`systemName:`. */
export function referencesInLine(line: string): string[] {
    const label = LABEL.exec(line);
    if (label === null) {
        return [];
    }
    const names: string[] = [];
    for (const literal of line.slice(label.index + label[0].length).matchAll(LITERAL)) {
        const name = literal[1] ?? "";
        if (SYMBOL_SHAPED.test(name)) {
            names.push(name);
        }
    }
    return names;
}

export function referencesInSource(source: string, file: string): SymbolReference[] {
    const found: SymbolReference[] = [];
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
        for (const name of referencesInLine(lines[index] ?? "")) {
            found.push({ file, line: index + 1, name });
        }
    }
    return found;
}

/** Every symbol name the installed catalog knows about. */
export function loadCatalog(json: string): Set<string> {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || !("symbols" in parsed)) {
        return new Set();
    }
    const symbols = parsed.symbols;
    if (typeof symbols !== "object" || symbols === null) {
        return new Set();
    }
    return new Set(Object.keys(symbols));
}

/** Every `.swift` file under `root`, sorted so the report is stable between runs. */
export function swiftFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (directory: string): void => {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            // A missing root is not an error: the shell version walked nothing and
            // reported zero references.
            return;
        }
        for (const entry of entries.sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".swift")) {
                found.push(full);
            }
        }
    };
    walk(root);
    return found;
}

/**
 * The catalog is a binary plist; `plutil` is the system's own reader for it, which
 * keeps this script free of a plist parser.
 */
function readCatalog(catalog: string): string {
    return execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", catalog], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

function main(): void {
    const root = process.argv[2] ?? ".";
    if (!existsSync(CATALOG) || !statSync(CATALOG).isFile()) {
        die(69, `error: SF Symbol catalog not found at ${CATALOG}`);
    }

    const known = loadCatalog(readCatalog(CATALOG));
    const bad: SymbolReference[] = [];
    let checked = 0;
    for (const file of swiftFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const reference of referencesInSource(source, path.relative(root, file))) {
            checked += 1;
            if (!known.has(reference.name)) {
                bad.push(reference);
            }
        }
    }

    for (const reference of bad) {
        console.log(`${reference.file}:${reference.line}: unknown SF Symbol "${reference.name}"`);
    }
    console.log(`checked ${checked} symbol reference(s), ${bad.length} unknown`);
    if (bad.length > 0) {
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runMain(main);
}
