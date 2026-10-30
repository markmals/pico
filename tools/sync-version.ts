// Changesets owns package.json; the xcconfig is its Apple-compatible projection.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const XCCONFIG = "Config/Version.xcconfig";

const ASSIGNMENT = /^(MARKETING_VERSION[ \t]*=[ \t]*).*$/m;

export function versionFrom(packageJson: string): string {
    let pkg: unknown = JSON.parse(packageJson);
    if (pkg && typeof pkg === "object" && "version" in pkg) {
        let version = pkg.version;
        if (typeof version === "string" && version.length > 0) return version;
    }
    throw new Error('package.json has no "version"');
}

// Apple bundle versions cannot contain semver prerelease or build suffixes.
export function appleVersion(version: string): string {
    let core = /^(\d+(?:\.\d+){0,2})(?:[-+].*)?$/.exec(version.trim());
    if (!core) {
        throw new Error(
            `cannot turn "${version}" into a MARKETING_VERSION: expected one to three dot-separated integers`,
        );
    }
    return core[1];
}

export function setMarketingVersion(xcconfig: string, version: string): string {
    if (!ASSIGNMENT.test(xcconfig)) {
        throw new Error(`${XCCONFIG} has no MARKETING_VERSION assignment to update`);
    }
    return xcconfig.replace(ASSIGNMENT, `$1${version}`);
}

if (import.meta.main) {
    // The root comes from this file, not the process's directory, so the script
    // behaves the same from a task, a hook or a terminal in a subdirectory.
    let root = dirname(dirname(fileURLToPath(import.meta.url)));
    let packageJson = readFileSync(join(root, "package.json"), "utf8");
    let marketingVersion = appleVersion(versionFrom(packageJson));

    let path = join(root, XCCONFIG);
    let current = readFileSync(path, "utf8");
    let updated = setMarketingVersion(current, marketingVersion);

    if (updated === current) {
        console.log(`${XCCONFIG}: MARKETING_VERSION already ${marketingVersion}`);
    } else {
        writeFileSync(path, updated);
        console.log(`${XCCONFIG}: MARKETING_VERSION ${marketingVersion}`);
    }
}
