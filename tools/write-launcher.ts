import {
    accessSync,
    chmodSync,
    constants,
    existsSync,
    mkdirSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

// Returns the failure message, or null when this path can carry the launcher's shebang.
// Nothing is guessed: the pinned Bun is the caller's to name, so a launcher can never end up
// running whichever Bun happened to be first on the builder's PATH.
export function bunPathProblem(bunPath: string | undefined): string | null {
    if (bunPath === undefined || bunPath === "") {
        return "the pinned Bun's path must be given as the first argument, as `mise run acp:launcher` does with `mise which bun`.";
    }
    if (!path.isAbsolute(bunPath)) {
        return `the pinned Bun's path must be absolute, and ${bunPath} is not: a shebang searches no PATH, least of all launchd's.`;
    }
    if (/\s/.test(bunPath)) {
        return `a shebang line cannot hold whitespace, and ${bunPath} contains some. Install Bun somewhere without spaces in its path.`;
    }
    if (!existsSync(bunPath)) return `there is no Bun at ${bunPath}.`;
    if (!statSync(bunPath).isFile()) return `${bunPath} is not a file.`;
    try {
        accessSync(bunPath, constants.X_OK);
    } catch {
        return `${bunPath} is not executable.`;
    }
    return null;
}

// The launcher is read by the kernel, which only knows the shebang, and then by Bun, which
// needs an absolute specifier: nothing resolves relative to the launcher's own location, and
// no PATH entry is involved, so launchd's environment is enough to run it.
export function launcherSource(bunPath: string, entryPath: string): string {
    return `#!${bunPath}\nimport ${JSON.stringify(entryPath)};\n`;
}

export function writeLauncher(launcherPath: string, source: string): void {
    mkdirSync(path.dirname(launcherPath), { recursive: true });
    writeFileSync(launcherPath, source, { mode: 0o755 });
    // `mode` applies to a file this call creates; an existing launcher keeps its own.
    chmodSync(launcherPath, 0o755);
}

function fail(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

function main(): void {
    let bunPath = process.argv[2] ?? "";
    let problem = bunPathProblem(bunPath);
    if (problem !== null) fail(problem);

    let repository = path.resolve(import.meta.dirname, "..");
    let launcherPath = path.join(repository, ".build", "pico-acp");

    writeLauncher(
        launcherPath,
        launcherSource(bunPath, path.join(repository, "adapter", "main.ts")),
    );

    process.stdout.write(`${launcherPath}\n`);
}

if (import.meta.main) main();
