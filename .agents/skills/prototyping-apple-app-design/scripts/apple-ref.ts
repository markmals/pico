/**
 * Screenshot Apple's own apps in the Simulator, to design against what the platform
 * actually does rather than a memory of it.
 *
 *   bun .agents/skills/prototyping-apple-app-design/scripts/apple-ref.ts --list
 *   bun .agents/skills/prototyping-apple-app-design/scripts/apple-ref.ts --app reminders --app settings --out /tmp/refs
 *
 * Uses a dedicated "Apple-Reference" simulator so it never disturbs a prototype's
 * device or whatever the user has booted.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { dominantCoverage, parseBmp } from "./lib/bmp.ts";
import { type OptionConfig, die, rejectArgs, runMain, sleep } from "./lib/cli.ts";
import { ensureSimulator } from "./lib/simctl.ts";

const SIM_NAME = "Apple-Reference";
const DEFAULT_DEVICE_TYPE = "iPhone 17 Pro";

// Verified present in the iOS simulator runtime. Apps not listed here (Music, Mail,
// Weather, Notes, Home, Books) ship only on device — for those, read the HIG page for
// the pattern instead of guessing at the app.
const BUNDLE_IDS: Record<string, string> = {
    reminders: "com.apple.reminders",
    settings: "com.apple.Preferences",
    maps: "com.apple.Maps",
    health: "com.apple.Health",
    fitness: "com.apple.Fitness",
    news: "com.apple.news",
    passwords: "com.apple.Passwords",
    shortcuts: "com.apple.shortcuts",
    calendar: "com.apple.mobilecal",
    contacts: "com.apple.MobileAddressBook",
    messages: "com.apple.MobileSMS",
    photos: "com.apple.mobileslideshow",
    safari: "com.apple.mobilesafari",
    files: "com.apple.DocumentsApp",
    wallet: "com.apple.Passbook",
};

const OPTIONS = {
    list: { type: "boolean" },
    app: { type: "string", multiple: true },
    out: { type: "string" },
    device: { type: "string" },
} as const satisfies Record<string, OptionConfig>;

export function bundleIdFor(app: string): string | undefined {
    // `hasOwn` keeps an app named "constructor" from resolving to something inherited.
    return Object.hasOwn(BUNDLE_IDS, app) ? BUNDLE_IDS[app] : undefined;
}

/** The same order the shell version's `--list` printed. */
export function knownApps(): string[] {
    return Object.keys(BUNDLE_IDS);
}

/**
 * True when one colour covers almost the whole capture — a launch frame, not the app.
 *
 * `sips` does the decoding; a 32px BMP is trivial to inspect without an image library.
 */
export function frameIsBlank(file: string): boolean {
    const probe = path.join(os.tmpdir(), "apple-ref-probe.bmp");
    const resized = spawnSync(
        "sips",
        ["-s", "format", "bmp", "--resampleWidth", "32", file, "--out", probe],
        {
            stdio: "ignore",
        },
    );
    if (resized.status !== 0) {
        return false;
    }
    try {
        return dominantCoverage(parseBmp(readFileSync(probe), probe)) >= 0.92;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: false });
    } catch (error) {
        rejectArgs(error, args, OPTIONS, false);
    }

    if (parsed.values.list === true) {
        for (const app of knownApps()) {
            console.log(app);
        }
        return;
    }

    const apps = parsed.values.app ?? [];
    const outDirectory = parsed.values.out ?? path.join(os.tmpdir(), "apple-reference");
    const deviceType = parsed.values.device ?? DEFAULT_DEVICE_TYPE;

    if (apps.length === 0) {
        die(64, "error: pass --app NAME (see --list)");
    }
    mkdirSync(outDirectory, { recursive: true });

    const udid = ensureSimulator(SIM_NAME, deviceType);

    for (const app of apps) {
        const bundle = bundleIdFor(app);
        if (bundle === undefined) {
            die(64, `error: unknown app '${app}' (see --list)`);
        }

        const launched = spawnSync(
            "xcrun",
            ["simctl", "launch", "--terminate-running-process", udid, bundle],
            {
                stdio: "ignore",
            },
        );
        if (launched.status !== 0) {
            process.stderr.write(`error: could not launch ${app} (${bundle}) on this runtime\n`);
            continue;
        }

        // Apple's apps give no readiness signal, so wait for the frame to stop changing.
        // Stability alone is not enough: a launch frame that is still solid black is
        // perfectly stable, and silently produces a "reference" with nothing in it.
        const out = path.join(outDirectory, `${app}.png`);
        // The shell version compared md5 digests; comparing the bytes is the same test
        // without hashing them first.
        let previous: Buffer | undefined;
        let settled = false;
        await sleep(2000);
        for (let attempt = 0; attempt < 24; attempt += 1) {
            const captured = spawnSync("xcrun", ["simctl", "io", udid, "screenshot", out], {
                stdio: "ignore",
            });
            if (captured.status !== 0) {
                die(captured.status ?? 1);
            }
            const current = readFileSync(out);
            if (previous !== undefined && current.equals(previous) && !frameIsBlank(out)) {
                settled = true;
                break;
            }
            previous = current;
            await sleep(500);
        }

        console.log(out);
        if (!settled) {
            process.stderr.write(
                `warning: ${app} never rendered content — treat ${out} as unusable and use the HIG page instead\n`,
            );
        }
    }

    // The device is intentionally left booted. Shutting it down makes the next run pay
    // the full boot cost again, which is what pushes a two-app capture past a command
    // timeout.
    process.stderr.write(
        "note: Apple's apps show first-launch onboarding, and some render an empty frame until\n" +
            "they have data. Look at each capture before trusting it — if it shows a welcome screen\n" +
            "rather than the app's real structure, fall back to the HIG page for that pattern.\n",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runMain(main);
}
