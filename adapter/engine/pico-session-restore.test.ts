import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { Context } from "@oh-my-pi/pi-ai";

import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PicoSession } from "./pico-session.ts";
import type { Cleanups } from "./testing/session-fixture.ts";
import type { TestProviderModels } from "./testing/test-provider.ts";

import { createPicoSession, PicoSessionError } from "./pico-session.ts";
import { exited, fakeMcpServer } from "./testing/mcp-fixture.ts";
import {
    PICO_ROSTER,
    picoWorkspace,
    unauthenticatedAuthStorage,
    withoutProviderCredentials,
} from "./testing/session-fixture.ts";
import { installTestProvider, TEST_PROVIDER } from "./testing/test-provider.ts";

/** A conversation that outlives its engine: a Pico-owned journal and the project it belongs to. */
interface Conversation {
    cwd: string;
    agentDir: string;
    dataDir: string;
    /** Pico's own session bucket, standing in for `~/Library/Application Support/Pico/sessions/<project>`. */
    sessionDir: string;
    models: TestProviderModels;
}

function conversation(t: Cleanups): Conversation {
    withoutProviderCredentials(t);
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    const models = installTestProvider(cwd);
    const sessionDir = path.join(dataDir, "sessions", path.basename(cwd));
    fs.mkdirSync(sessionDir, { recursive: true });
    return { cwd, agentDir, dataDir, sessionDir, models };
}

/**
 * A materialized empty journal in Pico's own bucket, the way proposal.0004
 * creates one: no terminal breadcrumb, and a stable identity before the first
 * prompt.
 */
function newJournal({ cwd, sessionDir }: Conversation): Promise<SessionManager> {
    return SessionManager.inMemory(cwd).persistCopy({ sessionDir, suppressBreadcrumb: true });
}

function reopenJournal({ sessionDir }: Conversation, file: string): Promise<SessionManager> {
    return SessionManager.open(file, sessionDir, undefined, {
        throwIfMissing: true,
        suppressBreadcrumb: true,
    });
}

/** The session file a journal must already have, because a reopenable identity is returned before the first prompt. */
function journalFile(manager: SessionManager): string {
    const file = manager.getSessionFile();
    assert.ok(file, "the journal was never materialized");
    return file;
}

async function attach(
    conversationUnderTest: Conversation,
    manager: SessionManager,
    mcpServers: McpServerStdio[] = [],
): Promise<PicoSession> {
    const { cwd, agentDir, dataDir } = conversationUnderTest;
    return createPicoSession({
        cwd,
        agentDir,
        dataDir,
        mcpServers,
        authStorage: await unauthenticatedAuthStorage(agentDir),
        sessionManager: manager,
    });
}

function textOf(content: unknown): string[] {
    if (typeof content === "string") return [content];
    if (!Array.isArray(content)) return [];
    const texts: string[] = [];
    for (const block of content) {
        if (typeof block === "string") {
            texts.push(block);
        } else if (
            typeof block === "object" &&
            block !== null &&
            "text" in block &&
            typeof block.text === "string"
        ) {
            texts.push(block.text);
        }
    }
    return texts;
}

/** Everything the model was actually sent as conversation, which is where a restored context has to show up. */
function conversationText(context: Context): string {
    return context.messages.flatMap(message => textOf(message.content)).join("\n");
}

/** The context of the model's most recent request, as the provider received it. */
function lastRequest(models: TestProviderModels, id: "alpha" | "beta" = "alpha"): Context {
    const call = models[id].calls.at(-1);
    assert.ok(call, `${TEST_PROVIDER}/${id} was never asked for a reply`);
    return call.context;
}

/**
 * Reproducible conversation turns. A seeded generator, not random input: the
 * claim is that every retained turn comes back, so the test needs more than one
 * hand-picked message and the same ones on every run. The multiplier and
 * modulus are MINSTD's, whose products stay exact in a double and whose full
 * period keeps every drawn turn distinct.
 */
function seededTurns(seed: number, count: number): string[] {
    const turns: string[] = [];
    let state = seed;
    for (let turn = 0; turn < count; turn++) {
        state = (state * 48_271) % 2_147_483_647;
        turns.push(`fact-${state.toString(36)}`);
    }
    return turns;
}

describe("proposal.0004 restored conversations", () => {
    test("a reopened journal keeps its identity and the conversation it saved", async t => {
        const underTest = conversation(t);
        const manager = await newJournal(underTest);
        const sessionId = manager.getSessionId();
        const file = journalFile(manager);

        const first = await attach(underTest, manager);
        await first.engine.prompt("the passphrase is mangosteen");
        await first.dispose();

        const reopened = await reopenJournal(underTest, file);
        assert.equal(reopened.getSessionId(), sessionId, "reopening minted a second identity");
        const second = await attach(underTest, reopened);
        t.after(() => second.dispose());
        await second.engine.prompt("what is the passphrase?");

        const restored = conversationText(lastRequest(underTest.models));
        assert.match(restored, /mangosteen/, "the saved user message is missing from the context");
        assert.match(restored, /from alpha/, "the saved reply is missing from the context");
        assert.equal(second.engine.sessionManager.getSessionId(), sessionId);
    });

    test("every turn of a generated conversation comes back, in order", async t => {
        const underTest = conversation(t);
        const turns = seededTurns(20_041_101, 4);
        const manager = await newJournal(underTest);
        const file = journalFile(manager);

        const first = await attach(underTest, manager);
        for (const fact of turns) await first.engine.prompt(`remember ${fact}`);
        await first.dispose();

        const second = await attach(underTest, await reopenJournal(underTest, file));
        t.after(() => second.dispose());
        await second.engine.prompt("list what you remember");

        const restored = conversationText(lastRequest(underTest.models));
        let reached = -1;
        for (const fact of turns) {
            const found = restored.indexOf(fact, reached + 1);
            assert.ok(found > reached, `${fact} is missing from the restored conversation`);
            reached = found;
        }
    });

    test("the model the session selected is the model that answers after reopening", async t => {
        const underTest = conversation(t);
        const manager = await newJournal(underTest);
        const file = journalFile(manager);

        const first = await attach(underTest, manager);
        const beta = first.engine
            .getAvailableModels()
            .find(model => model.provider === TEST_PROVIDER && model.id === "beta");
        assert.ok(beta, `the engine offers ${TEST_PROVIDER}/beta`);
        await first.selectModel(beta);
        await first.engine.prompt("hello");
        await first.dispose();

        const second = await attach(underTest, await reopenJournal(underTest, file));
        t.after(() => second.dispose());

        assert.equal(
            `${second.engine.model?.provider}/${second.engine.model?.id}`,
            "pico-test/beta",
        );
        const answered = underTest.models.beta.calls.length;
        await second.engine.prompt("again");
        assert.equal(underTest.models.beta.calls.length, answered + 1, "beta did not answer");
    });

    test("a saved model that is no longer available fails the reopen, names it, and keeps the journal", async t => {
        const underTest = conversation(t);
        const manager = await newJournal(underTest);
        const sessionId = manager.getSessionId();
        const file = journalFile(manager);

        const first = await attach(underTest, manager);
        const beta = first.engine
            .getAvailableModels()
            .find(model => model.provider === TEST_PROVIDER && model.id === "beta");
        assert.ok(beta, `the engine offers ${TEST_PROVIDER}/beta`);
        await first.selectModel(beta);
        await first.engine.prompt("hello");
        await first.dispose();

        // The provider this conversation ran on is gone from the project.
        fs.rmSync(path.join(underTest.cwd, ".omp", "extensions"), { recursive: true });
        const pidFile = path.join(underTest.cwd, "sesh.pid");
        const reopened = await reopenJournal(underTest, file);

        await assert.rejects(
            attach(underTest, reopened, [
                fakeMcpServer("extra", { flags: ["--pid-file", pidFile] }),
            ]),
            (error: unknown) => {
                assert.ok(error instanceof PicoSessionError);
                assert.match(error.message, /pico-test\/beta/);
                return true;
            },
        );
        await reopened.close();

        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        assert.ok(await exited(pid), `the MCP server (pid ${pid}) outlived the failed restoration`);
        const survivor = await reopenJournal(underTest, file);
        t.after(() => survivor.close());
        assert.equal(
            survivor.getSessionId(),
            sessionId,
            "the failed restoration replaced the journal",
        );
        assert.ok(survivor.getEntries().length > 0, "the failed restoration emptied the journal");
    });

    test("a reopened conversation keeps the curated roster and only the servers this request sends", async t => {
        const underTest = conversation(t);
        const manager = await newJournal(underTest);
        const file = journalFile(manager);
        const launchSchema = {
            type: "object",
            properties: {
                project: { type: "string" },
                prompt: { type: "string" },
                agent: { type: "string" },
            },
            required: ["project", "prompt"],
            additionalProperties: false,
        };

        const first = await attach(underTest, manager, [fakeMcpServer("extra")]);
        assert.ok(
            first.engine.getActiveToolNames().includes("mcp__extra_echo"),
            "the first attachment never mounted the server it was given",
        );
        await first.engine.prompt("hello");
        await first.dispose();

        const second = await attach(underTest, await reopenJournal(underTest, file), [
            fakeMcpServer("sesh", {
                flags: ["--tool", "start_session", "--input-schema", JSON.stringify(launchSchema)],
            }),
        ]);
        t.after(() => second.dispose());
        await second.engine.prompt("and now?");

        assert.match(
            conversationText(lastRequest(underTest.models)),
            /hello/,
            "the reopened attachment lost the saved conversation",
        );
        assert.deepEqual(
            [...second.engine.getActiveToolNames()].sort(),
            [...PICO_ROSTER, "mcp__sesh_start_session"].sort(),
            "the reopened attachment does not carry exactly Pico's roster and this request's server",
        );
        const launch = lastRequest(underTest.models).tools?.find(
            tool => tool.name === "mcp__sesh_start_session",
        );
        const parameters = launch?.parameters;
        assert.ok(
            typeof parameters === "object" && parameters !== null && "properties" in parameters,
            "Sesh's launch tool is missing from the reopened attachment, or declares no parameters",
        );
        const properties = parameters.properties;
        assert.ok(
            typeof properties === "object" && properties !== null && !("agent" in properties),
            "the reopened attachment offers the agent field Pico removes",
        );
        assert.equal(
            second.mcpToolIdentity("mcp__sesh_start_session")?.server,
            "sesh",
            "the reopened attachment does not report where its MCP tool came from",
        );
    });
});
