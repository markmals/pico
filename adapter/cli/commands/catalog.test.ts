import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CliError } from "../errors.ts";
import { userCatalog } from "./catalog.ts";

async function failure(open: () => Promise<unknown>): Promise<CliError> {
    try {
        await open();
    } catch (error) {
        if (error instanceof CliError) return error;
        throw error;
    }
    throw new Error("the credential store opened");
}

describe("proposal.0007 a credential store that cannot be opened", () => {
    test.skipIf(process.getuid?.() === 0)(
        "is UNAVAILABLE and not retryable, whatever words its path contains",
        async () => {
            const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pico-catalog-")));
            const agentDir = path.join(root, "busy-locked-home", ".omp", "agent");
            mkdirSync(agentDir, { recursive: true });
            chmodSync(agentDir, 0o500);
            try {
                const error = await failure(userCatalog(agentDir, path.join(root, "data")));

                expect(error.code).toBe("UNAVAILABLE");
                expect(error.retryable).toBe(false);
                expect(error.details.credentialStore).toBe(path.join(agentDir, "agent.db"));
            } finally {
                chmodSync(agentDir, 0o700);
                rmSync(root, { recursive: true, force: true });
            }
        },
    );
});
