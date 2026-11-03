import { afterEach, describe, expect, test } from "bun:test";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dir, "pico.ts");
const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    version: string;
};

const homes: string[] = [];

/** A scratch home, so nothing here touches the real `~/Library/Application Support/Pico`. */
function scratchHome(): string {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "pico-home-")));
    homes.push(home);
    return home;
}

afterEach(() => {
    for (const home of homes.splice(0)) {
        chmodSync(home, 0o755);
        rmSync(home, { recursive: true, force: true });
    }
});

async function runPico(args: string[], home: string) {
    const pico = Bun.spawn([process.execPath, ENTRY_POINT, ...args], {
        env: { HOME: home, PATH: "/usr/bin:/bin" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    pico.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([
        pico.exited,
        new Response(pico.stdout).text(),
        new Response(pico.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
}

describe("proposal.0002 the pico executable", () => {
    test("--version prints the package version and exits 0", async () => {
        const result = await runPico(["--version"], scratchHome());

        expect(result).toEqual({ exitCode: 0, stdout: `pico ${manifest.version}\n`, stderr: "" });
    }, 30_000);

    test("an unknown argument ends stderr with an INVALID_ARGUMENT error and exits 2 without starting ACP", async () => {
        const result = await runPico(["somefile"], scratchHome());

        expect(result.exitCode).toBe(2);
        expect(result.stdout).toBe("");
        expect(lastErrorDocument(result.stderr).error.code).toBe("INVALID_ARGUMENT");
    }, 30_000);

    test("a data directory that cannot be created stops pico before any ACP message", async () => {
        const home = scratchHome();
        mkdirSync(join(home, "Library"));
        chmodSync(join(home, "Library"), 0o555);

        const result = await runPico([], home);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toStartWith(
            `pico: cannot use ${join(home, "Library", "Application Support", "Pico")}: `,
        );
        chmodSync(join(home, "Library"), 0o755);
    }, 30_000);

    // The addon's package installs only on Apple silicon, the one platform `pico` ships for.
    test.skipIf(!(process.platform === "darwin" && process.arch === "arm64"))(
        "as an ACP agent it extracts the native addon into Pico's data directory",
        async () => {
            const home = scratchHome();

            const result = await runPico([], home);

            expect(result.exitCode).toBe(0);
            const nativesDir = join(home, "Library", "Application Support", "Pico", "natives");
            const natives = JSON.parse(
                readFileSync(
                    join(
                        import.meta.dir,
                        "..",
                        "node_modules",
                        "@oh-my-pi",
                        "pi-natives",
                        "package.json",
                    ),
                    "utf8",
                ),
            ) as { version: string };
            expect(
                readFileSync(join(nativesDir, natives.version, "pi_natives.darwin-arm64.node"))
                    .length,
            ).toBeGreaterThan(0);
        },
        30_000,
    );
});

function lastErrorDocument(stderr: string): { apiVersion: number; error: { code: string } } {
    const lines = stderr.trimEnd().split("\n");
    return JSON.parse(lines.at(-1) ?? "");
}

describe("proposal.0007 the pico command line", () => {
    test("discovery answers with no credentials, no network and a home it cannot write", async () => {
        const home = scratchHome();
        chmodSync(home, 0o555);

        const help = await runPico(["--help"], home);
        const index = await runPico(["schema"], home);
        const spec = await runPico(["schema", "settings", "update"], home);
        const search = await runPico(["cli", "search", "change the default model"], home);
        const commandHelp = await runPico(["settings", "update", "--help"], home);

        for (const result of [help, index, spec, search, commandHelp]) {
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
        expect(help.stdout).toContain("pico cli search");
        expect(JSON.parse(index.stdout).commands.length).toBeGreaterThan(0);
        expect(JSON.parse(spec.stdout).command).toBe("settings update");
        expect(JSON.parse(search.stdout).items[0].command).toBe("settings update");
        expect(commandHelp.stdout).toContain("--dry-run");
        expect(readdirSync(home)).toEqual([]);
    }, 30_000);

    test("settings get reports a missing file as one JSON document on stdout", async () => {
        const home = scratchHome();

        const result = await runPico(["settings", "get"], home);

        expect(result.exitCode).toBe(0);
        const document = JSON.parse(result.stdout);
        expect(document.apiVersion).toBe(1);
        expect(document.status).toBe("missing");
        expect(document.settingsFile).toBe(
            join(home, "Library", "Application Support", "Pico", "settings.json"),
        );
    }, 30_000);

    test("a refused update exits 1 with its error as the last stderr line and nothing on stdout", async () => {
        const home = scratchHome();

        const result = await runPico(
            ["settings", "update", "--default-model", "nobody/nothing"],
            home,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(lastErrorDocument(result.stderr).error.code).toBe("NOT_FOUND");
    }, 30_000);
});
