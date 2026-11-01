import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { picoWorkspace, useAsProcessAgentDir } from "../engine/testing/session-fixture.ts";
import { SessionStore } from "./session-store.ts";

describe("proposal.0004 terminal history ownership", () => {
    test("a released attachment cannot write through its old manager after another attachment opens", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        useAsProcessAgentDir(t, agentDir);
        const store = new SessionStore(dataDir);
        const previous = await store.create(cwd);
        const file = previous.manager.getSessionFile()!;
        await previous.close();
        const current = await store.open(previous.sessionId, cwd);
        try {
            const saved = fs.readFileSync(file, "utf8");
            previous.manager.appendCustomEntry("late-event", {
                text: "must not reach the released journal",
            });
            await previous.manager.flush();
            assert.equal(
                fs.readFileSync(file, "utf8"),
                saved,
                "the old manager wrote after giving up ownership",
            );
        } finally {
            previous.manager.seal();
            await previous.manager.close();
            previous.manager.releaseRetainedEntries();
            await current.close();
        }
    });

    test("an attached journal cannot be redirected outside the owned root even with the same header id", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);
        useAsProcessAgentDir(t, agentDir);
        const store = new SessionStore(dataDir);
        const stored = await store.create(cwd);
        const file = stored.manager.getSessionFile()!;
        const bucket = path.dirname(file);
        const moved = `${bucket}-original`;
        const outside = path.join(dataDir, "outside-history");
        fs.mkdirSync(outside);
        fs.copyFileSync(file, path.join(outside, path.basename(file)));
        fs.renameSync(bucket, moved);
        fs.symlinkSync(outside, bucket);
        try {
            const before = fs.readFileSync(path.join(outside, path.basename(file)), "utf8");
            await assert.rejects(() => stored.flush(), /storage|save/i);
            assert.equal(fs.readFileSync(path.join(outside, path.basename(file)), "utf8"), before);
        } finally {
            fs.unlinkSync(bucket);
            fs.renameSync(moved, bucket);
            await stored.close();
        }
    });
});
