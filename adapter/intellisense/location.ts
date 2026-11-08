// Where Pico expects the user's own `intellisense` CLI, shared by `pico intellisense check` and
// by every session attach (pico-bfk.20). It reads the filesystem and nothing else: the process
// facts it depends on arrive as an argument, so a test never depends on the machine it runs on.

import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const EXECUTABLE_NAME = "intellisense";

/** Where a session or a check would find the executable, and why it would not. */
export type IntellisenseLocation =
    | { status: "found"; source: LocationSource; path: string }
    | { status: "missing"; source: "discovered"; path: null; searched: string[]; problem: string }
    | { status: "unusable"; source: LocationSource; path: string | null; problem: string };

/** Whether the location came from the settings file or from Pico's own search. */
export type LocationSource = "settings" | "discovered";

/** The process facts resolution depends on: the search path, and the home directory `~` means. */
export interface IntellisenseEnvironment {
    path: string | undefined;
    home: string | undefined;
}

/** The directories searched after `PATH`, where the CLIs people install usually land. */
const INSTALL_DIRECTORIES = [
    "~/.cargo/bin",
    "~/.local/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
] as const;

export function processEnvironment(): IntellisenseEnvironment {
    return { path: process.env["PATH"], home: homedir() };
}

/**
 * A saved path decides on its own: when it cannot be used, that is the answer, because silently
 * running a different copy than the one the user chose would hide their mistake.
 */
export function resolveIntellisense(
    saved: string | null,
    environment: IntellisenseEnvironment,
): IntellisenseLocation {
    if (saved !== null) {
        const problem = executableProblem(saved);
        return problem === undefined
            ? { status: "found", source: "settings", path: saved }
            : {
                  status: "unusable",
                  source: "settings",
                  path: saved,
                  problem: `${saved} ${problem.description}`,
              };
    }
    const searched = searchDirectories(environment);
    for (const directory of searched) {
        const candidate = path.join(directory, EXECUTABLE_NAME);
        if (executableProblem(candidate) === undefined) {
            return { status: "found", source: "discovered", path: candidate };
        }
    }
    return {
        status: "missing",
        source: "discovered",
        path: null,
        searched,
        problem: `No ${EXECUTABLE_NAME} executable in ${searched.join(", ")}`,
    };
}

/** Why a path cannot be run as the executable, or `undefined` when it can. */
export type ExecutableProblem = {
    kind: "absent" | "not-a-file" | "not-executable";
    description: string;
};

/** Symlinks are followed for the check and kept in the path, so a package link survives upgrades. */
export function executableProblem(candidate: string): ExecutableProblem | undefined {
    let entry;
    try {
        entry = statSync(candidate);
    } catch {
        return { kind: "absent", description: "does not exist" };
    }
    if (!entry.isFile()) return { kind: "not-a-file", description: "is not a regular file" };
    try {
        accessSync(candidate, constants.X_OK);
    } catch {
        return { kind: "not-executable", description: "is not executable" };
    }
    return undefined;
}

function searchDirectories(environment: IntellisenseEnvironment): string[] {
    const searched: string[] = [];
    const seen = new Set<string>();
    const add = (directory: string): void => {
        if (directory.length === 0 || seen.has(directory)) return;
        seen.add(directory);
        searched.push(directory);
    };
    for (const entry of (environment.path ?? "").split(path.delimiter)) add(entry);
    const home = environment.home ?? "";
    for (const directory of INSTALL_DIRECTORIES) {
        if (!directory.startsWith("~/")) add(directory);
        else if (home.length > 0) add(path.join(home, directory.slice(2)));
    }
    return searched;
}
