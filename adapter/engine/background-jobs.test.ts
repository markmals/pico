import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

import { describe, expect, test } from "bun:test";

import { BackgroundJobs } from "./background-jobs.ts";

/**
 * An engine with no jobs whose `suppressAutoResumeUntilPrompt()` throws the first time, as any
 * engine call inside a stop could; only the surface `BackgroundJobs` drives exists.
 */
function engineFailingOnce(): AgentSession {
    let failed = false;
    const engine = {
        subscribe: () => () => {},
        asyncJobManager: { getRunningJobs: () => [], getAllJobs: () => [] },
        suppressAutoResumeUntilPrompt: () => {
            if (failed) return;
            failed = true;
            throw new Error("the engine refused once");
        },
    };
    return engine as unknown as AgentSession;
}

describe("proposal.0008 stopping background jobs", () => {
    test("a stop that failed does not keep a later stop from running", async () => {
        const jobs = new BackgroundJobs(engineFailingOnce());

        await expect(jobs.stop()).rejects.toThrow("the engine refused once");

        expect(await jobs.stop()).toBe(true);
    });
});
