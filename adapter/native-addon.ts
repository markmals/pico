import {
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { DataDirError } from "./data-dir.ts";

/** How long another version's directory must sit unused before it is removed: Oh My Pi's figure. */
const IDLE_VERSION_MS = 10 * 60_000;

export interface NativeAddonInstall {
    /** The addon `pico` carries: a `/$bunfs` path in a compiled build. */
    source: string;
    /** `<data dir>/natives`, which OMP's loader reads through `PI_NATIVES_DIR`. */
    nativesDir: string;
    /** The `@oh-my-pi/pi-natives` version, which names the directory OMP's loader looks in. */
    version: string;
    filename: string;
}

/**
 * Writes the carried addon to `<natives>/<version>/<filename>` unless an identical file is
 * already there, and removes every other version's directory. OMP's own extraction only
 * compares sizes, which would load a tampered file of the same length; this compares bytes.
 */
export function installNativeAddon(install: NativeAddonInstall): string {
    const versionDir = join(install.nativesDir, install.version);
    const target = join(versionDir, install.filename);
    // Marked first, so another version's cleanup sees this one in use before it is loaded.
    markInUse(versionDir);
    // `readFileSync` works on `/$bunfs`; `copyFileSync` does not.
    const content = readFileSync(install.source);
    if (!matches(target, content)) {
        writeAtomically(target, content);
    }
    removeIdleVersions(install.nativesDir, install.version);
    return target;
}

function markInUse(versionDir: string): void {
    try {
        mkdirSync(versionDir, { recursive: true });
        const now = new Date();
        utimesSync(versionDir, now, now);
    } catch (error) {
        throw new DataDirError(versionDir, error);
    }
}

function matches(target: string, content: Buffer): boolean {
    try {
        return readFileSync(target).equals(content);
    } catch {
        return false;
    }
}

function writeAtomically(target: string, content: Buffer): void {
    const temporary = `${target}.${process.pid}.tmp`;
    try {
        writeFileSync(temporary, content, { mode: 0o755 });
        renameSync(temporary, target);
    } catch (error) {
        rmSync(temporary, { force: true });
        throw new DataDirError(target, error);
    }
}

/**
 * Removes other versions' directories nothing has marked for {@link IDLE_VERSION_MS}, as Oh My
 * Pi's own loader does: a process of that version that is still starting has marked its
 * directory, and one already running keeps the addon it loaded, because the mapping outlives
 * the deleted file. Only version-named directories go; Oh My Pi keeps other caches here, such
 * as `grammars/`.
 */
function removeIdleVersions(nativesDir: string, version: string): void {
    for (const entry of readdirSync(nativesDir)) {
        if (entry === version || !/^\d+\.\d+\.\d+/.test(entry)) continue;
        const path = join(nativesDir, entry);
        try {
            if (Date.now() - statSync(path).mtimeMs < IDLE_VERSION_MS) continue;
            rmSync(path, { recursive: true, force: true });
        } catch (error) {
            throw new DataDirError(path, error);
        }
    }
}
