import type { Dirent } from "node:fs";

import fs from "node:fs";
import path from "node:path";

import { describeCause } from "../engine/errors.ts";
import { SessionStoreError } from "./errors.ts";

/** The journals Pico owns, and the root they were found under. */
export interface OwnedJournals {
    /** The canonical session root; `undefined` when nothing has been stored yet. */
    readonly root: string | undefined;
    /** Canonical paths of the journals in the root's buckets. */
    readonly files: readonly string[];
}

/** Resolves entries under an expected canonical parent, rejecting symlinks; missing entries return undefined. */
export async function ownedEntry(parent: string, name: string): Promise<string | undefined> {
    const entry = path.join(parent, name);
    let resolved: string;
    try {
        resolved = await fs.promises.realpath(entry);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new SessionStoreError(
            "storage",
            `could not resolve ${entry}: ${describeCause(error)}`,
            { cause: error },
        );
    }
    if (resolved !== entry) {
        throw new SessionStoreError(
            "storage",
            `${entry} leads out of Pico's session storage, to ${resolved}`,
        );
    }
    return resolved;
}

/**
 * The canonical session root, or `undefined` when nothing has been stored yet.
 *
 * The root is `sessions` in Pico's data directory and nowhere else: a link in
 * its place would make every later write land in whatever it points at,
 * including OMP's own terminal history.
 */
export async function ownedRoot(root: string): Promise<string | undefined> {
    const parent = path.dirname(root);
    let canonicalParent: string;
    try {
        canonicalParent = await fs.promises.realpath(parent);
    } catch (error) {
        throw new SessionStoreError(
            "storage",
            `could not resolve ${parent}: ${describeCause(error)}`,
            { cause: error },
        );
    }
    return await ownedEntry(canonicalParent, path.basename(root));
}

/**
 * Every journal in a bucket of `root`.
 *
 * This is Pico's own discovery, not a view of someone else's index: a directory
 * it cannot read, and anything below the root that leads out of it, is reported
 * rather than skipped, because a page or a lookup that quietly left them out
 * would claim history the user has is not there.
 */
export async function scanOwnedJournals(root: string): Promise<OwnedJournals> {
    const canonicalRoot = await ownedRoot(root);
    if (!canonicalRoot) return { root: undefined, files: [] };
    const buckets = await readDirectory(canonicalRoot);
    if (!buckets) return { root: undefined, files: [] };
    const files: string[] = [];
    for (const bucket of buckets) {
        if (bucket.isFile()) continue;
        const directory = await ownedEntry(canonicalRoot, bucket.name);
        if (!directory) continue;
        const entries = await readDirectory(directory);
        if (!entries) continue;
        for (const entry of entries) {
            if (entry.isDirectory() || !entry.name.endsWith(".jsonl")) continue;
            const file = await ownedEntry(directory, entry.name);
            if (file) files.push(file);
        }
    }
    return { root: canonicalRoot, files };
}

/** The entries of `directory`, or `undefined` when it does not exist. */
async function readDirectory(directory: string): Promise<Dirent[] | undefined> {
    try {
        return await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new SessionStoreError(
            "storage",
            `could not read ${directory}: ${describeCause(error)}`,
            { cause: error },
        );
    }
}
