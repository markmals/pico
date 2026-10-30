import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions, findDeviceUdid, newestIosRuntime } from "./simctl.ts";

const DEVICES = JSON.stringify({
    devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
            { name: "iPhone Air", udid: "AAAA" },
            { name: "Prototype-iPhone", udid: "BBBB" },
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
            { name: "Prototype-iPhone", udid: "CCCC" },
        ],
    },
});

test("finds a device by name on an iOS runtime", () => {
    assert.equal(findDeviceUdid(DEVICES, "Prototype-iPhone"), "BBBB");
});

test("ignores identically named devices on other platforms", () => {
    const watchOnly = JSON.stringify({
        devices: {
            "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
                { name: "Apple-Reference", udid: "CCCC" },
            ],
        },
    });
    assert.equal(findDeviceUdid(watchOnly, "Apple-Reference"), undefined);
});

test("an absent device is undefined, which is what triggers creation", () => {
    assert.equal(findDeviceUdid(DEVICES, "Apple-Reference"), undefined);
    assert.equal(findDeviceUdid("{}", "Apple-Reference"), undefined);
});

test("orders runtime versions numerically, not as strings", () => {
    assert.ok(compareVersions("27.0", "26.4") > 0);
    assert.ok(compareVersions("18.0", "9.0") > 0);
    assert.ok(compareVersions("26.1", "26.10") < 0);
    assert.equal(compareVersions("27.0", "27.0"), 0);
    assert.ok(compareVersions("27.0.1", "27.0") > 0);
});

test("picks the newest available iOS runtime", () => {
    const runtimes = JSON.stringify({
        runtimes: [
            { isAvailable: true, name: "iOS 26.4", version: "26.4", identifier: "iOS-26-4" },
            { isAvailable: true, name: "iOS 27.0", version: "27.0", identifier: "iOS-27-0" },
            {
                isAvailable: true,
                name: "watchOS 27.0",
                version: "27.0",
                identifier: "watchOS-27-0",
            },
        ],
    });
    assert.equal(newestIosRuntime(runtimes), "iOS-27-0");
});

test("skips runtimes Xcode reports as unavailable", () => {
    const runtimes = JSON.stringify({
        runtimes: [
            { isAvailable: false, name: "iOS 27.0", version: "27.0", identifier: "iOS-27-0" },
            { isAvailable: true, name: "iOS 26.4", version: "26.4", identifier: "iOS-26-4" },
        ],
    });
    assert.equal(newestIosRuntime(runtimes), "iOS-26-4");
});

test("no iOS runtime at all is an error, not an empty identifier", () => {
    assert.throws(() => newestIosRuntime('{"runtimes": []}'), /no available iOS simulator runtime/);
});
