import { directoryIsEnterableSync, resolveEquivalentPath } from "@oh-my-pi/pi-utils/dirs";
import fs from "node:fs";
import path from "node:path";

import { describeCause } from "../engine/errors.ts";
import { SessionStoreError } from "./errors.ts";

/** Restoring requires an existing, enterable project; listing uses canonicalDirectory instead. */
export function requireProject(cwd: string): string {
    if (!path.isAbsolute(cwd)) {
        throw new SessionStoreError(
            "invalid",
            `the working directory must be an absolute path, and "${cwd}" is not`,
        );
    }
    let resolved: string;
    try {
        resolved = fs.realpathSync(cwd);
        if (!directoryIsEnterableSync(resolved)) {
            throw new SessionStoreError(
                "invalid",
                `the working directory "${cwd}" is not an enterable directory`,
            );
        }
    } catch (error) {
        if (error instanceof SessionStoreError) throw error;
        throw new SessionStoreError(
            "invalid",
            `the working directory "${cwd}" cannot be used: ${describeCause(error)}`,
            { cause: error },
        );
    }
    return resolved;
}

/** Resolves surviving ancestors too, so removed projects retain the same canonical filter. */
export function canonicalDirectory(cwd: string): string {
    if (!path.isAbsolute(cwd)) {
        throw new SessionStoreError(
            "invalid",
            `the working directory must be an absolute path, and "${cwd}" is not`,
        );
    }
    return resolveEquivalentPath(cwd, { throughMissing: true });
}
