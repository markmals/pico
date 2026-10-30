import assert from "node:assert/strict";
import test from "node:test";

import { slugify } from "./new-prototype.ts";

test("a display name becomes a bundle-safe slug", () => {
    assert.equal(slugify("Reading Tracker"), "reading-tracker");
    assert.equal(slugify("Habit Tracker"), "habit-tracker");
});

test("runs of punctuation collapse to one dash", () => {
    assert.equal(slugify("Notes & Lists"), "notes-lists");
    assert.equal(slugify("Wheels — 2026 Edition"), "wheels-2026-edition");
});

test("a trailing dash is trimmed", () => {
    assert.equal(slugify("Reading Tracker!"), "reading-tracker");
    assert.equal(slugify("Reading Tracker "), "reading-tracker");
});

test("digits survive", () => {
    assert.equal(slugify("Top 10"), "top-10");
});
