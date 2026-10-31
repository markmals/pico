import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createPicoSession } from "./pico-session.ts";
import { createMockModel, mockAuthStorage, picoWorkspace } from "./testing/session-fixture.ts";

describe("proposal.0002 the model cache", () => {
    test("lives in Pico's data directory, not in OMP's agent directory", async t => {
        const { cwd, agentDir, dataDir } = picoWorkspace(t);

        const session = await createPicoSession({
            cwd,
            agentDir,
            dataDir,
            mcpServers: [],
            authStorage: await mockAuthStorage(agentDir),
            model: createMockModel({ responses: [{ content: ["ok"] }] }),
        });
        t.after(() => session.dispose());

        assert.ok(
            fs.existsSync(path.join(dataDir, "models.db")),
            "models.db is in the data directory",
        );
        assert.ok(
            !fs.existsSync(path.join(agentDir, "models.db")),
            "OMP's agent directory gets no models.db",
        );
    });
});
