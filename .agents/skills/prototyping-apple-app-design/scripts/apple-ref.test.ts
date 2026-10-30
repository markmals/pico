import assert from "node:assert/strict";
import test from "node:test";

import { bundleIdFor, knownApps } from "./apple-ref.ts";

test("resolves an app name to the bundle the simulator actually ships", () => {
    assert.equal(bundleIdFor("reminders"), "com.apple.reminders");
    assert.equal(bundleIdFor("settings"), "com.apple.Preferences");
    assert.equal(bundleIdFor("calendar"), "com.apple.mobilecal");
});

test("an app that only ships on device is unknown here", () => {
    // Music, Mail, Weather, Notes, Home, and Books are not in the simulator runtime;
    // the HIG page is the reference for those.
    for (const app of ["music", "mail", "weather", "notes", "home", "books"]) {
        assert.equal(bundleIdFor(app), undefined, app);
    }
});

test("inherited object properties are not app names", () => {
    assert.equal(bundleIdFor("constructor"), undefined);
    assert.equal(bundleIdFor("toString"), undefined);
});

test("--list prints every app the lookup knows, and nothing else", () => {
    assert.deepEqual(knownApps(), [
        "reminders",
        "settings",
        "maps",
        "health",
        "fitness",
        "news",
        "passwords",
        "shortcuts",
        "calendar",
        "contacts",
        "messages",
        "photos",
        "safari",
        "files",
        "wallet",
    ]);
    for (const app of knownApps()) {
        assert.equal(typeof bundleIdFor(app), "string", app);
    }
});
