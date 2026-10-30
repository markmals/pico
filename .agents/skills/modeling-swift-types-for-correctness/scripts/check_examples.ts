#!/usr/bin/env bun
/**
 * Compatibility entry point for the bundled Swift fixture checks.
 *
 * It keeps the historical environment toggles: the compile checks tolerate an
 * unavailable compiler unless REQUIRE_SWIFTC=1, and the imported compiler corpus
 * only runs when CHECK_SWIFT_COMPILER_CORPUS=1.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Environment = Record<string, string | undefined>;

export function compileCheckArguments(root: string, environment: Environment): string[] {
    const argumentList = [
        path.join(root, "scripts", "swift_compile_checks.ts"),
        path.join(root, "examples", "compile-checks.json"),
    ];
    // The skip stays opt-out: only REQUIRE_SWIFTC=1 turns an unavailable compiler
    // into a failure instead of a clearly reported skip.
    if ((environment.REQUIRE_SWIFTC ?? "0") !== "1") {
        argumentList.push("--allow-unavailable");
    }
    return argumentList;
}

/** Returns null when the corpus lane is not requested. */
export function corpusArguments(root: string, environment: Environment): string[] | null {
    if ((environment.CHECK_SWIFT_COMPILER_CORPUS ?? "0") !== "1") {
        return null;
    }
    const argumentList = [
        path.join(root, "scripts", "swift_compiler_corpus.ts"),
        path.join(root, "examples", "compiler-corpus-map.json"),
    ];
    const frontend = environment.SWIFT_FRONTEND ?? "";
    if (frontend !== "") {
        argumentList.push("--swiftc", frontend);
    }
    return argumentList;
}

/** Runs a sibling helper on this process's own runtime, never a separate one. */
function runHelper(argumentList: string[]): number {
    const result = spawnSync(process.execPath, argumentList, { stdio: "inherit" });
    if (result.error !== undefined) {
        console.error(`error: ${result.error.message}`);
        return 1;
    }
    // A signal-terminated child has no exit status; report failure rather than success.
    return result.signal !== null ? 1 : (result.status ?? 1);
}

export function main(environment: Environment = process.env): number {
    const compileCheckStatus = runHelper(compileCheckArguments(ROOT, environment));
    if (compileCheckStatus !== 0) {
        return compileCheckStatus;
    }
    const corpus = corpusArguments(ROOT, environment);
    return corpus === null ? 0 : runHelper(corpus);
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    process.exitCode = main();
}
