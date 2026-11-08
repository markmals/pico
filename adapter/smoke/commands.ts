// `mise run pico:verify`'s checks of the compiled `pico` command line (proposal.0007): discovery
// answers, the settings round trip through the offline catalog, and a refused change. Each
// result is parsed with the schema its command declares, so the binary's output is checked too.
// Commands run asynchronously: the fake model server lives in this process and must keep
// answering Oh My Pi's discovery while `pico` runs.

import type { z } from "zod/v4";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Checklist } from "./checklist.ts";
import type { Scratch } from "./verify.ts";

import {
    intellisenseCheckOutput,
    schemaOutput,
    searchOutput,
    settingsGetOutput,
    settingsUpdateOutput,
} from "../cli/result-schemas.ts";

/** The offline catalog's one model, which every new verify session starts on once saved. */
export const VERIFY_MODEL = "lm-studio/echo";

interface Run {
    exitCode: number;
    stdout: string;
    stderr: string;
}

type Outcome<T> = { value: T; problem: null } | { value: undefined; problem: string };

async function run(
    executable: string,
    scratch: Scratch,
    args: string[],
    stdin?: string,
): Promise<Run> {
    const child = Bun.spawn([executable, ...args], {
        env: scratch.env,
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
}

/** A successful command's result, parsed with the schema it declares. */
function parsed<T>(outcome: Run, schema: z.ZodType<T>): Outcome<T> {
    if (outcome.exitCode !== 0) {
        return {
            value: undefined,
            problem: `exit ${outcome.exitCode}, stderr ${outcome.stderr.slice(-400)}`,
        };
    }
    try {
        const checked = schema.safeParse(JSON.parse(outcome.stdout));
        if (checked.success) return { value: checked.data, problem: null };
        return { value: undefined, problem: `stdout breaks its schema: ${checked.error.message}` };
    } catch {
        return {
            value: undefined,
            problem: `stdout is not one JSON document: ${outcome.stdout.slice(0, 200)}`,
        };
    }
}

function settingsFile(scratch: Scratch): string {
    return path.join(scratch.home, "Library", "Application Support", "Pico", "settings.json");
}

function settingsBytes(scratch: Scratch): string | undefined {
    const file = settingsFile(scratch);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function lastErrorCode(stderr: string): string | undefined {
    try {
        const document: unknown = JSON.parse(stderr.trimEnd().split("\n").at(-1) ?? "");
        if (typeof document !== "object" || document === null || !("error" in document)) return;
        const { error } = document;
        if (typeof error !== "object" || error === null || !("code" in error)) return;
        return typeof error.code === "string" ? error.code : undefined;
    } catch {
        return undefined;
    }
}

async function checkDiscovery(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const help = await run(executable, scratch, ["--help"]);
    checklist.record(
        "`pico --help` orients a newcomer toward search and schema",
        help.exitCode === 0 && help.stdout.includes("pico cli search") ? null : help.stderr,
    );
    const search = parsed(
        await run(executable, scratch, ["cli", "search", "change the default model"]),
        searchOutput,
    );
    checklist.record(
        "`pico cli search` finds `settings update` for changing the default model",
        search.problem ??
            (search.value.items[0]?.command === "settings update"
                ? null
                : `results ${JSON.stringify(search.value.items)}`),
    );
    const spec = parsed(
        await run(executable, scratch, ["schema", "settings", "update"]),
        schemaOutput,
    );
    checklist.record(
        "`pico schema settings update` describes the command",
        spec.problem ?? ("command" in spec.value ? null : "it printed the index"),
    );
}

async function checkSettingsRoundTrip(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const missing = parsed(await run(executable, scratch, ["settings", "get"]), settingsGetOutput);
    checklist.record(
        "`pico settings get` reports that no settings are saved yet",
        missing.problem ?? (missing.value.status === "missing" ? null : missing.value.status),
    );
    const update = ["settings", "update", "--default-model", VERIFY_MODEL];
    const preview = parsed(
        await run(executable, scratch, [...update, "--dry-run"]),
        settingsUpdateOutput,
    );
    checklist.record(
        "a dry run previews the change and writes nothing",
        preview.problem ??
            (preview.value.dryRun && settingsBytes(scratch) === undefined
                ? null
                : `receipt ${JSON.stringify(preview.value)}`),
    );
    const saved = parsed(await run(executable, scratch, update), settingsUpdateOutput);
    checklist.record(
        "`pico settings update` saves the default model",
        saved.problem ??
            (saved.value.changed && settingsBytes(scratch) !== undefined ? null : "nothing saved"),
    );
    const read = parsed(await run(executable, scratch, ["settings", "get"]), settingsGetOutput);
    const effective = read.value?.effective;
    checklist.record(
        "`pico settings get` reads the saved default back as usable",
        read.problem ??
            (effective?.defaultModel === VERIFY_MODEL && effective.available
                ? null
                : `effective ${JSON.stringify(effective)}`),
    );
}

async function checkRefusal(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const before = settingsBytes(scratch);
    const refused = await run(executable, scratch, [
        "settings",
        "update",
        "--default-model",
        "lm-studio/nothing",
    ]);
    const code = lastErrorCode(refused.stderr);
    checklist.record(
        "a refused change exits 1 with NOT_FOUND and leaves the settings file as it was",
        refused.exitCode === 1 &&
            refused.stdout === "" &&
            code === "NOT_FOUND" &&
            settingsBytes(scratch) === before
            ? null
            : `exit ${refused.exitCode}, error ${code}, stderr ${refused.stderr.slice(-300)}`,
    );
}

async function checkCredentialBoundaries(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const before = settingsBytes(scratch);
    const indexFile = path.join(path.dirname(settingsFile(scratch)), "credentials.db");
    const indexBefore = existsSync(indexFile) ? readFileSync(indexFile) : undefined;
    const fakeKey = "FAKE-pico-compiled-preview-not-a-live-key";
    const preview = await run(
        executable,
        scratch,
        ["credentials", "create", "--provider", "openai", "--stdin", "--dry-run"],
        fakeKey,
    );
    let planned = false;
    try {
        planned = JSON.parse(preview.stdout).dryRun === true;
    } catch {
        planned = false;
    }
    const indexUnchanged =
        indexBefore === undefined
            ? !existsSync(indexFile)
            : existsSync(indexFile) && indexBefore.equals(readFileSync(indexFile));
    checklist.record(
        "compiled API-key preview neither stores nor exposes its input",
        preview.exitCode === 0 &&
            planned &&
            !preview.stdout.includes(fakeKey) &&
            !preview.stderr.includes(fakeKey) &&
            settingsBytes(scratch) === before &&
            indexUnchanged
            ? null
            : `exit ${preview.exitCode}; preview or no-write boundary failed`,
    );
    const refused = await run(executable, scratch, ["auth", "login", "github-copilot"]);
    checklist.record(
        "compiled URL-only login refuses a known prompt-dependent SDK method",
        refused.exitCode === 1 &&
            refused.stdout === "" &&
            lastErrorCode(refused.stderr) === "FAILED_PRECONDITION"
            ? null
            : `exit ${refused.exitCode}, code ${lastErrorCode(refused.stderr)}`,
    );
}

/** The version the scratch home's stand-in `intellisense` prints, which the check must read back. */
const FAKE_INTELLISENSE_VERSION = "intellisense 0.0.0-pico-verify";

/**
 * The GUI PATH problem this setting exists for: with a bare PATH and a scratch home, Pico finds
 * no `intellisense` until one is chosen, and then runs exactly the one that was chosen.
 */
async function checkIntellisenseLocation(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    const fake = path.join(scratch.home, "tools", "intellisense");
    mkdirSync(path.dirname(fake), { recursive: true });
    writeFileSync(fake, `#!/bin/sh\necho '${FAKE_INTELLISENSE_VERSION}'\n`, { mode: 0o755 });
    const missing = parsed(
        await run(executable, scratch, ["intellisense", "check"]),
        intellisenseCheckOutput,
    );
    checklist.record(
        "`pico intellisense check` reports no intellisense on a bare PATH",
        missing.problem ??
            (missing.value.status === "missing"
                ? null
                : `status ${missing.value.status}, path ${JSON.stringify(missing.value.path)}`),
    );
    const saved = parsed(
        await run(executable, scratch, ["settings", "update", "--intellisense-path", fake]),
        settingsUpdateOutput,
    );
    checklist.record(
        "`pico settings update --intellisense-path` saves the chosen executable",
        saved.problem ??
            (saved.value.changed && saved.value.after.item.intellisensePath === fake
                ? null
                : `receipt ${JSON.stringify(saved.value.after.item)}`),
    );
    const ready = parsed(
        await run(executable, scratch, ["intellisense", "check"]),
        intellisenseCheckOutput,
    );
    checklist.record(
        "`pico intellisense check` runs the chosen executable and reports its version",
        ready.problem ??
            (ready.value.status === "ready" &&
            ready.value.source === "settings" &&
            ready.value.path === fake &&
            ready.value.version === FAKE_INTELLISENSE_VERSION
                ? null
                : `document ${JSON.stringify(ready.value)}`),
    );
}

/** Saves the offline model as the default, which the session checks then start on. */
export async function checkCommands(
    executable: string,
    scratch: Scratch,
    checklist: Checklist,
): Promise<void> {
    await checkDiscovery(executable, scratch, checklist);
    await checkSettingsRoundTrip(executable, scratch, checklist);
    await checkRefusal(executable, scratch, checklist);
    await checkCredentialBoundaries(executable, scratch, checklist);
    await checkIntellisenseLocation(executable, scratch, checklist);
}
