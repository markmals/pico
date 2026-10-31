import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DataDirError } from "./data-dir.ts";

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
    // `readFileSync` works on `/$bunfs`; `copyFileSync` does not.
    const content = readFileSync(install.source);
    if (!matches(target, content)) {
        writeAtomically(versionDir, target, content);
    }
    removeOtherVersions(install.nativesDir, install.version);
    return target;
}

function matches(target: string, content: Buffer): boolean {
    try {
        return readFileSync(target).equals(content);
    } catch {
        return false;
    }
}

function writeAtomically(versionDir: string, target: string, content: Buffer): void {
    const temporary = `${target}.${process.pid}.tmp`;
    try {
        mkdirSync(versionDir, { recursive: true });
        writeFileSync(temporary, content, { mode: 0o755 });
        renameSync(temporary, target);
    } catch (error) {
        rmSync(temporary, { force: true });
        throw new DataDirError(target, error);
    }
}

/**
 * A process still running an older `pico` keeps the addon it loaded: the mapping outlives
 * the deleted file.
 */
function removeOtherVersions(nativesDir: string, version: string): void {
    for (const entry of readdirSync(nativesDir)) {
        if (entry === version) continue;
        const path = join(nativesDir, entry);
        try {
            rmSync(path, { recursive: true, force: true });
        } catch (error) {
            throw new DataDirError(path, error);
        }
    }
}
