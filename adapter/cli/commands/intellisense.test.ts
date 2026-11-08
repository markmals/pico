import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IntellisenseEnvironment } from "../../intellisense/location.ts";
import type { CommandInput } from "../command.ts";

import { settingsFilePath, writeSettings } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { intellisenseCheckOutput } from "../result-schemas.ts";
import { intellisenseCheck } from "./intellisense.ts";
import { input } from "./testing.ts";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-intellisense-check-")));
    roots.push(root);
    return root;
}

/** A data directory, a home with no installed copy, and a PATH holding one empty directory. */
function workspace(): { dataDir: string; environment: IntellisenseEnvironment; home: string } {
    const root = temporaryRoot();
    const dataDir = path.join(root, "data");
    const home = path.join(root, "home");
    const bin = path.join(root, "empty");
    for (const made of [dataDir, home, bin]) mkdirSync(made, { recursive: true });
    return { dataDir, home, environment: { path: bin, home } };
}

function script(file: string, body: string): string {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
}

function saveIntellisensePath(dataDir: string, intellisensePath: string | null): void {
    writeSettings(dataDir, {
        defaultModel: null,
        defaultThinking: null,
        autoBackground: null,
        intellisensePath,
        providerCredentials: {},
    });
}

async function check(
    options: { dataDir: string; environment: IntellisenseEnvironment; timeoutMs?: number },
    given: CommandInput = input(),
) {
    const handler = intellisenseCheck(
        { dataDir: options.dataDir },
        { environment: options.environment, timeoutMs: options.timeoutMs },
    );
    return intellisenseCheckOutput.parse({ apiVersion: 1, ...(await handler(given)) });
}

describe("pico-bfk.20 pico intellisense check", () => {
    test("with nothing saved and nothing installed, it reports what it searched", async () => {
        const { dataDir, environment, home } = workspace();

        const result = await check({ dataDir, environment });

        expect(result.settingsFile).toBe(settingsFilePath(dataDir));
        expect(result.status).toBe("missing");
        expect(result).toMatchObject({
            source: "discovered",
            path: null,
            searched: expect.arrayContaining([path.join(home, ".cargo", "bin")]) as unknown as [],
        });
    });

    test("a saved executable is ready, with the first line it prints as its version", async () => {
        const { dataDir, environment } = workspace();
        const executable = script(
            path.join(dataDir, "..", "tools", "intellisense"),
            "echo '  intellisense 0.2.0  '\necho 'second line'",
        );
        saveIntellisensePath(dataDir, executable);

        const result = await check({ dataDir, environment });

        expect(result).toEqual({
            apiVersion: 1,
            settingsFile: settingsFilePath(dataDir),
            status: "ready",
            source: "settings",
            path: executable,
            version: "intellisense 0.2.0",
        });
    });

    test("a discovered executable is ready too, and says it was discovered", async () => {
        const { dataDir, environment } = workspace();
        const executable = script(
            path.join(environment.path as string, "intellisense"),
            "echo 'intellisense 1.0.0'",
        );

        const result = await check({ dataDir, environment });

        expect(result).toMatchObject({
            status: "ready",
            source: "discovered",
            path: executable,
            version: "intellisense 1.0.0",
        });
    });

    test("a saved path that cannot be used is unusable, and nothing is run", async () => {
        const { dataDir, environment } = workspace();
        const missing = path.join(dataDir, "..", "tools", "intellisense");
        saveIntellisensePath(dataDir, missing);

        const result = await check({ dataDir, environment });

        expect(result).toMatchObject({
            status: "unusable",
            source: "settings",
            path: missing,
            problem: `${missing} does not exist`,
        });
    });

    test("a failing --version is unusable, with its exit status and first stderr line", async () => {
        const { dataDir, environment } = workspace();
        const executable = script(
            path.join(dataDir, "..", "tools", "intellisense"),
            "echo 'unknown flag --version' >&2\necho 'and more' >&2\nexit 1",
        );
        saveIntellisensePath(dataDir, executable);

        const result = await check({ dataDir, environment });

        expect(result.status).toBe("unusable");
        expect("problem" in result ? result.problem : "").toBe(
            "`intellisense --version` exited 1: unknown flag --version",
        );
    });

    test("a --version that prints nothing is unusable", async () => {
        const { dataDir, environment } = workspace();
        const executable = script(path.join(dataDir, "..", "tools", "intellisense"), "exit 0");
        saveIntellisensePath(dataDir, executable);

        const result = await check({ dataDir, environment });

        expect(result.status).toBe("unusable");
        expect("problem" in result ? result.problem : "").toBe(
            "`intellisense --version` printed no version",
        );
    });

    test("a --version that does not finish in time is unusable", async () => {
        const { dataDir, environment } = workspace();
        const executable = script(
            path.join(dataDir, "..", "tools", "intellisense"),
            "exec sleep 5",
        );
        saveIntellisensePath(dataDir, executable);

        const result = await check({ dataDir, environment, timeoutMs: 150 });

        expect(result.status).toBe("unusable");
        expect("problem" in result ? result.problem : "").toBe(
            "`intellisense --version` did not finish within 0.15 seconds",
        );
    });

    test("a settings file Pico cannot use fails the check before it looks", async () => {
        const { dataDir, environment } = workspace();
        writeFileSync(settingsFilePath(dataDir), '{"version":99}');

        const failure = await rejected({ dataDir, environment });

        expect(failure.code).toBe("FAILED_PRECONDITION");
        expect(failure.message).toContain(settingsFilePath(dataDir));
    });

    test("a settings file that cannot be read is an IO failure", async () => {
        const { dataDir, environment } = workspace();
        mkdirSync(settingsFilePath(dataDir));

        const failure = await rejected({ dataDir, environment });

        expect(failure.code).toBe("IO_ERROR");
    });
});

async function rejected(options: {
    dataDir: string;
    environment: IntellisenseEnvironment;
}): Promise<CliError> {
    try {
        await check(options);
    } catch (error) {
        if (error instanceof CliError) return error;
        throw error;
    }
    throw new Error("the check succeeded");
}
