/**
 * Build a prototype and screenshot its screens, so design work can be looked at
 * instead of imagined.
 *
 *   bun .agents/skills/prototyping-apple-app-design/scripts/shoot.ts --project DIR --all
 *   bun .agents/skills/prototyping-apple-app-design/scripts/shoot.ts --project DIR --screen noteList --condition failing --appearance dark
 *   bun .agents/skills/prototyping-apple-app-design/scripts/shoot.ts --project DIR --platform macos --screen noteList
 *
 * Screens are addressed by their `Screen` case name in ScreenCatalog.swift.
 * Output PNGs land in <project>/.shots and their paths are printed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
    type OptionConfig,
    die,
    rejectArgs,
    runMain,
    sleep,
    stripTrailingNewlines,
} from "./lib/cli.ts";
import { ensureSimulator } from "./lib/simctl.ts";

const DEFAULT_DEVICE_TYPE = "iPhone 17 Pro";
const DEFAULT_SIM_NAME = "Prototype-iPhone";
/** 150 polls at 200ms: thirty seconds for a screen to report itself ready. */
const READY_POLLS = 150;

const OPTIONS = {
    project: { type: "string" },
    platform: { type: "string" },
    device: { type: "string" },
    screen: { type: "string", multiple: true },
    all: { type: "boolean" },
    condition: { type: "string" },
    appearance: { type: "string" },
    "text-size": { type: "string" },
    variant: { type: "string", multiple: true },
    "all-variants": { type: "boolean" },
} as const satisfies Record<string, OptionConfig>;

export type CaptureOptions = {
    readonly variant: string;
    readonly condition: string;
    readonly appearance: string;
    readonly textSize: string;
};

export function simulatorNameFor(deviceType: string): string {
    return `Prototype-${deviceType.replaceAll(" ", "-")}`;
}

/**
 * Case names of a bare `enum <name>` block — the `sed` range the shell version used.
 *
 * Only `case foo` on a line of its own counts, which is what keeps a raw value or a
 * comma-separated list from being mistaken for a screen.
 */
export function extractEnumCases(source: string, enumName: string): string[] {
    const opens = new RegExp(`^enum ${enumName}`);
    const CASE = /^ *case ([a-zA-Z][a-zA-Z0-9]*)$/;
    const found: string[] = [];
    let inside = false;
    for (const line of source.split("\n")) {
        if (!inside) {
            if (!opens.test(line)) {
                continue;
            }
            inside = true;
        } else if (/^}/.test(line)) {
            inside = false;
            continue;
        }
        const match = CASE.exec(line);
        if (match?.[1] !== undefined) {
            found.push(match[1]);
        }
    }
    return found;
}

/** First `PRODUCT_BUNDLE_IDENTIFIER` in the project file, or "" when there is none. */
export function bundleIdentifier(pbxproj: string): string {
    const PATTERN = /PRODUCT_BUNDLE_IDENTIFIER = ([^;]*);/g;
    for (const line of pbxproj.split("\n")) {
        let last: string | undefined;
        for (const match of line.matchAll(PATTERN)) {
            last = match[1];
        }
        if (last !== undefined) {
            return last;
        }
    }
    return "";
}

/**
 * Flags shared by every launch. `-capture 1` hides the on-screen knobs so they never
 * appear in a design screenshot.
 *
 * Every flag MUST carry a value. AppKit parses argv into the NSUserDefaults argument
 * domain, and a valueless flag consumes the next argument — on macOS that leaves the
 * app running with no window, and this script waiting forever for a rect.
 */
export function launchFlags(screen: string, options: CaptureOptions): string[] {
    const flags = ["-capture", "1", "-screen", screen];
    if (options.variant !== "") {
        flags.push("-variant", options.variant);
    }
    if (options.condition !== "") {
        flags.push("-condition", options.condition);
    }
    if (options.appearance !== "") {
        flags.push("-appearance", options.appearance);
    }
    if (options.textSize !== "") {
        flags.push("-text-size", options.textSize);
    }
    return flags;
}

export function captureSuffix(options: CaptureOptions): string {
    let parts = "";
    for (const value of [
        options.variant,
        options.condition,
        options.appearance,
        options.textSize,
    ]) {
        if (value !== "") {
            parts += `-${value}`;
        }
    }
    return parts;
}

/** The compiler diagnostics worth surfacing out of an otherwise quiet build log. */
export function buildErrorLines(log: string): string[] {
    const unique = new Set(log.split("\n").filter(line => line.includes("error:")));
    return [...unique].sort().slice(0, 20);
}

function main(): Promise<void> {
    const args = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: false });
    } catch (error) {
        rejectArgs(error, args, OPTIONS, false);
    }
    const values = parsed.values;

    const platform = values.platform ?? "ios";
    const deviceType = values.device ?? DEFAULT_DEVICE_TYPE;
    const simName =
        values.device === undefined ? DEFAULT_SIM_NAME : simulatorNameFor(values.device);
    const capture: CaptureOptions = {
        variant: "",
        condition: values.condition ?? "",
        appearance: values.appearance ?? "",
        textSize: values["text-size"] ?? "",
    };

    if (values.project === undefined) {
        die(64, "error: --project is required");
    }
    const project = path.resolve(values.project);
    if (!existsSync(project) || !statSync(project).isDirectory()) {
        die(1, `error: no such directory: ${values.project}`);
    }
    const pbxprojPath = path.join(project, "Prototype.xcodeproj/project.pbxproj");
    if (!existsSync(pbxprojPath)) {
        die(66, `error: no Prototype.xcodeproj in ${project}`);
    }

    if (platform === "macos" && capture.textSize !== "") {
        process.stderr.write(
            "warning: macOS does not scale with Dynamic Type, so --text-size will not\n",
        );
        process.stderr.write(
            "         change these captures. Check Mac text scaling by resizing the\n",
        );
        process.stderr.write("         window, or capture the same views on iPad instead.\n");
    }

    const bundleId = bundleIdentifier(readFileSync(pbxprojPath, "utf8"));
    const catalog = path.join(project, "Shared/Harness/ScreenCatalog.swift");
    const shots = path.join(project, ".shots");
    const derived = path.join(project, ".build");
    mkdirSync(shots, { recursive: true });

    const screens = [...(values.screen ?? [])];
    if (values.all === true) {
        // The gallery is the harness's own index, not a designed screen, so it is skipped
        // when a variant is requested — otherwise every state run produces an identical
        // copy of it and buries the captures that actually differ.
        const skipGallery =
            capture.condition !== "" || capture.appearance !== "" || capture.textSize !== "";
        for (const screen of extractEnumCases(readFileSync(catalog, "utf8"), "Screen")) {
            if (skipGallery && screen === "gallery") {
                continue;
            }
            screens.push(screen);
        }
    }
    if (screens.length === 0) {
        die(64, "error: pass --screen NAME or --all");
    }

    const variants = [...(values.variant ?? [])];
    if (values["all-variants"] === true) {
        const source = readFileSync(path.join(project, "Shared/Harness/Variant.swift"), "utf8");
        variants.push(...extractEnumCases(source, "Variant"));
    }
    // An empty entry means "don't pass -variant at all", which is the common case.
    if (variants.length === 0) {
        variants.push("");
    }

    /**
     * Build quietly, but never swallow a failure: a hidden `error:` line turns a one-line
     * typo into a debugging session against a generic "BUILD FAILED".
     */
    const buildFor = (destination: string): void => {
        const log = path.join(derived, "last-build.log");
        mkdirSync(derived, { recursive: true });
        const handle = openSync(log, "w");
        let status: number | null;
        try {
            status = spawnSync(
                "xcodebuild",
                [
                    "-project",
                    path.join(project, "Prototype.xcodeproj"),
                    "-scheme",
                    "Prototype",
                    "-destination",
                    destination,
                    "-derivedDataPath",
                    derived,
                    "build",
                ],
                { stdio: ["ignore", handle, handle] },
            ).status;
        } finally {
            closeSync(handle);
        }
        if (status !== 0) {
            die(
                65,
                `error: build failed for ${destination}`,
                ...buildErrorLines(readFileSync(log, "utf8")),
                `full log: ${log}`,
            );
        }
    };

    const shootIos = async (): Promise<void> => {
        // A dedicated device keeps this from fighting with whatever simulator the user
        // (or another agent) already has booted.
        const udid = ensureSimulator(simName, deviceType);

        buildFor(`id=${udid}`);
        const installed = spawnSync(
            "xcrun",
            [
                "simctl",
                "install",
                udid,
                path.join(derived, "Build/Products/Debug-iphonesimulator/Prototype.app"),
            ],
            { stdio: "inherit" },
        );
        if (installed.status !== 0) {
            die(installed.status ?? 1);
        }

        const container = execFileSync(
            "xcrun",
            ["simctl", "get_app_container", udid, bundleId, "data"],
            {
                encoding: "utf8",
            },
        ).trim();

        for (const variant of variants) {
            const options: CaptureOptions = { ...capture, variant };
            for (const screen of screens) {
                const marker = path.join(container, "Documents/prototype-ready.txt");
                rmSync(marker, { force: true });
                const launched = spawnSync(
                    "xcrun",
                    [
                        "simctl",
                        "launch",
                        "--terminate-running-process",
                        udid,
                        bundleId,
                        ...launchFlags(screen, options),
                    ],
                    { stdio: ["ignore", "ignore", "inherit"] },
                );
                if (launched.status !== 0) {
                    die(launched.status ?? 1);
                }

                let waited = 0;
                while (readMarker(marker) !== screen) {
                    await sleep(200);
                    waited += 1;
                    if (waited > READY_POLLS) {
                        die(
                            75,
                            `error: '${screen}' never reported ready (is the case registered in ScreenCatalog.swift?)`,
                        );
                    }
                }
                await sleep(400);

                const out = path.join(shots, `${screen}${captureSuffix(options)}.png`);
                const captured = spawnSync("xcrun", ["simctl", "io", udid, "screenshot", out], {
                    stdio: "ignore",
                });
                // A capture that did not happen must not be reported as a path to look at.
                if (captured.status !== 0) {
                    die(captured.status ?? 1);
                }
                console.log(out);
            }
        }
        spawnSync("xcrun", ["simctl", "terminate", udid, bundleId], { stdio: "ignore" });
    };

    const shootMacos = async (): Promise<void> => {
        buildFor(`platform=macOS,arch=${os.machine()}`);
        const app = path.join(derived, "Build/Products/Debug/Prototype.app");
        const binary = path.join(app, "Contents/MacOS/Prototype");

        for (const variant of variants) {
            const options: CaptureOptions = { ...capture, variant };
            for (const screen of screens) {
                const ready = path.join("/tmp", `prototype-ready.${process.pid}-${readyCounter()}`);
                rmSync(ready, { force: true });
                // Match this project's own binary, never `-x Prototype`: the user is very
                // likely running the same-named app from Xcode, and killing it mid-iteration
                // is exactly the interruption this workflow exists to avoid.
                spawnSync("pkill", ["-f", binary], { stdio: "ignore" });
                // `open -n` forces a fresh instance; launching the inner binary directly
                // gives an app that never activates a window.
                const opened = spawnSync(
                    "open",
                    ["-n", app, "--args", ...launchFlags(screen, options), "-ready", ready],
                    {
                        stdio: "inherit",
                    },
                );
                if (opened.status !== 0) {
                    die(opened.status ?? 1);
                }

                let waited = 0;
                while (!hasContent(ready)) {
                    await sleep(200);
                    waited += 1;
                    if (waited > READY_POLLS) {
                        die(75, `error: '${screen}' never reported a window rect`);
                    }
                }

                const out = path.join(shots, `macos-${screen}${captureSuffix(options)}.png`);
                const rect = stripTrailingNewlines(readFileSync(ready, "utf8"));
                const captured = spawnSync("screencapture", ["-x", "-o", "-R", rect, out], {
                    stdio: "inherit",
                });
                if (captured.status !== 0) {
                    // `screencapture` needs Screen Recording permission for the process that
                    // runs this script; without it, it fails here rather than at launch.
                    spawnSync("pkill", ["-f", binary], { stdio: "ignore" });
                    die(captured.status ?? 1);
                }
                spawnSync("pkill", ["-f", binary], { stdio: "ignore" });
                rmSync(ready, { force: true });
                console.log(out);
            }
        }
    };

    if (platform === "ios") {
        return shootIos();
    }
    if (platform === "macos") {
        return shootMacos();
    }
    die(64, "error: --platform must be ios or macos");
}

function readMarker(marker: string): string {
    try {
        return stripTrailingNewlines(readFileSync(marker, "utf8"));
    } catch {
        return "";
    }
}

function hasContent(file: string): boolean {
    const stats = statSync(file, { throwIfNoEntry: false });
    return stats !== undefined && stats.size > 0;
}

let readyIndex = 0;
function readyCounter(): number {
    readyIndex += 1;
    return readyIndex;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runMain(main);
}
