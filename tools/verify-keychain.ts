import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

import { compilePico } from "./build-pico.ts";

interface ProbeResult {
    exitCode: number;
    document: { reference?: string; persisted?: boolean; deleted?: boolean };
    errorCode?: string;
    keychainCode?: string;
    errorMessage?: string;
}

const repoRoot = path.resolve(import.meta.dir, "..");
const probe = path.join(repoRoot, "adapter/smoke/keychain-probe.ts");
const allowUI = process.argv.includes("--allow-keychain-ui");

async function runProbe(
    executable: string[],
    operation: string,
    dataDir: string,
    service: string,
    reference?: string,
): Promise<ProbeResult> {
    const args = [operation, dataDir, service, ...(reference ? [reference] : [])];
    if (allowUI) args.push("--allow-keychain-ui");
    const child = Bun.spawn([...executable, ...args], {
        env: {
            HOME: userInfo().homedir,
            PATH: "/usr/bin:/bin",
            PI_CODING_AGENT_DIR: path.join(dataDir, "engine"),
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    const lines = stdout.trimEnd().split("\n");
    const document = stdout.trim() ? JSON.parse(lines.at(-1)!) : {};
    let errorCode: string | undefined;
    let keychainCode: string | undefined;
    let errorMessage: string | undefined;
    if (stderr.trim()) {
        try {
            const failure = JSON.parse(stderr.trimEnd().split("\n").at(-1)!).error;
            errorCode = failure.code;
            keychainCode = failure.keychain;
            errorMessage = failure.message;
        } catch {
            throw new Error(`Synthetic ${operation} emitted non-JSON diagnostics:\n${stderr}`);
        }
    }
    return { exitCode, document, errorCode, keychainCode, errorMessage };
}

function succeeded(result: ProbeResult, operation: string): void {
    if (result.exitCode !== 0) {
        throw new Error(
            `Synthetic ${operation} failed: ${result.errorCode ?? "unknown"}: ${result.errorMessage ?? ""}`,
        );
    }
}

async function compileProbe(output: string, revision: number): Promise<void> {
    const entrypoint = `${output}.ts`;
    await Bun.write(
        entrypoint,
        `import path from "node:path";
import { ensureDataDir } from ${JSON.stringify(path.join(repoRoot, "adapter/data-dir.ts"))};
import { installNativeAddon } from ${JSON.stringify(path.join(repoRoot, "adapter/native-addon.ts"))};
import carried from ${JSON.stringify(path.join(repoRoot, "adapter/carried-addon.ts"))};
ensureDataDir(process.argv[3]);
const nativesDir = path.join(process.argv[3], "natives");
installNativeAddon({
    source: carried.path, version: carried.version, nativesDir,
    filename: "pi_natives.darwin-arm64.node",
});
process.env.PI_NATIVES_DIR = nativesDir;
console.log(JSON.stringify({build:${revision}}));
// The probe intentionally loads the SDK only after its platform addon is installed.
await import(${JSON.stringify(probe)});
`,
    );
    await compilePico({ repoRoot, entrypoint, outfile: output });
}

async function roundTrip(executable: string[], dataDir: string, service: string) {
    const created = await runProbe(executable, "create", dataDir, service);
    succeeded(created, "create");
    const reference = created.document.reference;
    if (!reference) throw new Error("Synthetic create returned no reference");
    try {
        succeeded(await runProbe(executable, "refresh", dataDir, service, reference), "refresh");
        succeeded(await runProbe(executable, "read", dataDir, service, reference), "restart/read");
        console.log("OK: durable SDK refresh, process restart, no plaintext metadata");
        return reference;
    } catch (error) {
        const cleanup = await runProbe(executable, "delete", dataDir, service, reference);
        succeeded(cleanup, "cleanup after failure");
        throw error;
    }
}

async function verify(): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Keychain verification requires macOS");
    const root = mkdtempSync(path.join(tmpdir(), "pico-keychain-verify-"));
    const buildDir = path.join(repoRoot, ".build/keychain-smoke");
    mkdirSync(buildDir, { recursive: true });
    const executable = path.join(buildDir, "probe");
    const backup = path.join(buildDir, "original");
    const replacement = path.join(buildDir, "replacement");
    const sourceService = `me.malstrom.pico.research.${randomUUID()}`;
    const compiledService = `me.malstrom.pico.research.${randomUUID()}`;
    const sourceData = path.join(root, "source");
    const compiledData = path.join(root, "compiled");
    let sourceReference: string | undefined;
    let compiledReference: string | undefined;
    let replaced = false;
    try {
        sourceReference = await roundTrip([process.execPath, probe], sourceData, sourceService);
        succeeded(
            await runProbe(
                [process.execPath, probe],
                "delete",
                sourceData,
                sourceService,
                sourceReference,
            ),
            "source deletion",
        );
        sourceReference = undefined;
        await compileProbe(executable, 1);
        copyFileSync(executable, backup);
        compiledReference = await roundTrip([executable], compiledData, compiledService);
        await compileProbe(replacement, 2);
        renameSync(replacement, executable);
        replaced = true;
        const changed = await runProbe(
            [executable],
            "read",
            compiledData,
            compiledService,
            compiledReference,
        );
        if (changed.exitCode === 0) {
            console.log("OK: replacement executable retained permitted Keychain access");
        } else if (
            ["KEYCHAIN_ACCESS_DENIED", "KEYCHAIN_LOCKED"].includes(changed.errorCode ?? "") ||
            changed.keychainCode === "KEYCHAIN_UI_REQUIRED"
        ) {
            console.log(
                `OK: replacement fails explicitly (${changed.errorCode}), without fallback or ACL weakening`,
            );
            console.log(
                "LIMIT: authorizing the replacement with an OS dialog requires an explicit --allow-keychain-ui run",
            );
        } else {
            succeeded(changed, "replacement read");
        }
        copyFileSync(backup, executable);
        replaced = false;
        succeeded(
            await runProbe([executable], "read", compiledData, compiledService, compiledReference),
            "original executable recovery",
        );
        console.log("OK: restoring the original executable preserves the durable credential");
    } finally {
        if (replaced) copyFileSync(backup, executable);
        if (sourceReference) {
            succeeded(
                await runProbe(
                    [process.execPath, probe],
                    "delete",
                    sourceData,
                    sourceService,
                    sourceReference,
                ),
                "source cleanup",
            );
        }
        if (compiledReference) {
            succeeded(
                await runProbe(
                    [executable],
                    "delete",
                    compiledData,
                    compiledService,
                    compiledReference,
                ),
                "compiled cleanup",
            );
        }
        rmSync(root, { recursive: true, force: true });
    }
    console.log("OK: synthetic Keychain items deleted; no real provider credentials used");
}

await verify();
