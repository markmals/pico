/**
 * Resolving — and provisioning — the dedicated simulator a capture runs on.
 *
 * Both `apple-ref.ts` and `shoot.ts` need their own device, so a capture never fights
 * with whatever simulator the user (or another agent) already has booted.
 */

import { execFileSync, spawnSync } from "node:child_process";

import { isRecord } from "./json.ts";

/**
 * The UDID of an iOS simulator called `name`, or undefined when none exists yet.
 *
 * The key of each device list is the runtime *identifier*
 * (`com.apple.CoreSimulator.SimRuntime.iOS-27-0`), so matching "iOS" on it keeps a
 * watchOS or tvOS device of the same name out of the result.
 */
export function findDeviceUdid(devicesJson: string, name: string): string | undefined {
    const parsed: unknown = JSON.parse(devicesJson);
    if (!isRecord(parsed)) {
        return undefined;
    }
    const byRuntime = parsed["devices"];
    if (!isRecord(byRuntime)) {
        return undefined;
    }
    for (const [runtime, devices] of Object.entries(byRuntime)) {
        if (!runtime.includes("iOS") || !Array.isArray(devices)) {
            continue;
        }
        for (const device of devices) {
            if (!isRecord(device)) {
                continue;
            }
            const udid = device["udid"];
            if (device["name"] === name && typeof udid === "string") {
                return udid;
            }
        }
    }
    return undefined;
}

/**
 * Order two runtime versions ("26.0", "27.1") oldest-first.
 *
 * The bash version sorted the version *strings*, which would have preferred "9.0" over
 * "18.0". Comparing segments numerically gives the same answer for every runtime an
 * Xcode 26+ install ships, and the right one if an older runtime is installed too.
 */
export function compareVersions(a: string, b: string): number {
    const left = a.split(".");
    const right = b.split(".");
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index] ?? "0";
        const rightPart = right[index] ?? "0";
        const leftNumber = Number.parseInt(leftPart, 10);
        const rightNumber = Number.parseInt(rightPart, 10);
        if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
            if (leftPart !== rightPart) {
                return leftPart < rightPart ? -1 : 1;
            }
            continue;
        }
        if (leftNumber !== rightNumber) {
            return leftNumber - rightNumber;
        }
    }
    return 0;
}

/** Identifier of the newest available iOS runtime — what a new device is created on. */
export function newestIosRuntime(runtimesJson: string): string {
    const parsed: unknown = JSON.parse(runtimesJson);
    const runtimes = isRecord(parsed) ? parsed["runtimes"] : undefined;
    const available: { identifier: string; version: string }[] = [];
    if (Array.isArray(runtimes)) {
        for (const runtime of runtimes) {
            if (!isRecord(runtime)) {
                continue;
            }
            const name = runtime["name"];
            const identifier = runtime["identifier"];
            const version = runtime["version"];
            if (
                runtime["isAvailable"] !== true ||
                typeof name !== "string" ||
                !name.includes("iOS")
            ) {
                continue;
            }
            if (typeof identifier !== "string" || typeof version !== "string") {
                continue;
            }
            available.push({ identifier, version });
        }
    }
    available.sort((a, b) => compareVersions(a.version, b.version));
    const newest = available.at(-1);
    if (newest === undefined) {
        throw new Error("no available iOS simulator runtime");
    }
    return newest.identifier;
}

export function simctl(args: readonly string[]): string {
    return execFileSync("xcrun", ["simctl", ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

/** Find the named simulator, creating it on the newest runtime first if need be. */
export function ensureSimulator(name: string, deviceType: string): string {
    const existing = findDeviceUdid(simctl(["list", "devices", "-j"]), name);
    const udid =
        existing ??
        simctl([
            "create",
            name,
            deviceType,
            newestIosRuntime(simctl(["list", "runtimes", "-j"])),
        ]).trim();
    // `-b` boots the device if it is shut down and blocks until it is usable. A failure
    // is not fatal — an already-booted device can report one — so it is ignored, exactly
    // as the `|| true` in the shell version did.
    spawnSync("xcrun", ["simctl", "bootstatus", udid, "-b"], { stdio: "ignore" });
    return udid;
}
