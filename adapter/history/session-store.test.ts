import type { ListSessionsRequest, McpServerStdio } from "@agentclientprotocol/sdk";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent";
import type { TestContext } from "node:test";

import { RequestError } from "@agentclientprotocol/sdk";
import { SessionManager as Sessions } from "@oh-my-pi/pi-coding-agent";
import { sessionDirForCwd } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import { getSessionsDir } from "@oh-my-pi/pi-utils/dirs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { PicoSession } from "../engine/pico-session.ts";
import type { ConnectedClient } from "../server/agent-harness.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import {
    picoWorkspace,
    temporaryDirectory,
    unauthenticatedAuthStorage,
    useAsProcessAgentDir,
} from "../engine/testing/session-fixture.ts";
import { installTestProvider } from "../engine/testing/test-provider.ts";
import { connectPicoAgent } from "../server/agent-harness.ts";
import { picoAgentShutdown } from "../server/pico-agent.ts";

/** ACP error codes these tests name: an unknown session, and a rejected parameter. */
const SESSION_NOT_FOUND = -32002;
const INVALID_PARAMS = -32602;

/** A request that failed, captured so a missing method fails an assertion rather than the test. */
interface Failure {
    readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

function isFailure<T>(result: T | Failure): result is Failure {
    return typeof result === "object" && result !== null && "error" in result;
}

async function outcome<T>(pending: Promise<T>): Promise<T | Failure> {
    try {
        return await pending;
    } catch (error) {
        return {
            error: {
                code: error instanceof RequestError ? error.code : 0,
                message: error instanceof Error ? error.message : String(error),
                data: error instanceof RequestError ? error.data : undefined,
            },
        };
    }
}

function succeeded<T>(result: T | Failure): T {
    if (isFailure(result)) {
        assert.fail(`the request failed with ${result.error.code}: ${result.error.message}`);
    }
    return result;
}

function rejected<T>(result: T | Failure): Failure["error"] {
    if (!isFailure(result)) assert.fail(`the request succeeded: ${JSON.stringify(result)}`);
    return result.error;
}

/** One connection factory over one workspace, so a test can close a connection and open the next. */
async function fixture(t: TestContext) {
    const { cwd, agentDir, dataDir } = picoWorkspace(t);
    useAsProcessAgentDir(t, agentDir);
    const models = installTestProvider(cwd);
    const authStorage = await unauthenticatedAuthStorage(agentDir);
    const connections: ConnectedClient[] = [];
    const state = { factoryCalls: 0, factoryFailure: undefined as string | undefined };
    const connect = async () => {
        const client = connectPicoAgent({
            version: "0.0.0-test",
            dataDir,
            createSession: async (
                directory: string,
                mcpServers: McpServerStdio[],
                sessionManager: SessionManager,
            ): Promise<PicoSession> => {
                state.factoryCalls++;
                if (state.factoryFailure) throw new Error(state.factoryFailure);
                return await createPicoSession({
                    cwd: directory,
                    agentDir,
                    dataDir,
                    authStorage,
                    mcpServers,
                    sessionManager,
                });
            },
        });
        connections.push(client);
        await client.initialize();
        return client;
    };
    t.after(async () => {
        for (const client of connections) await disconnect(client);
        authStorage.close();
    });
    return {
        cwd,
        agentDir,
        dataDir,
        models,
        state,
        connect,
        sessionsRoot: path.join(dataDir, "sessions"),
    };
}

async function disconnect(client: ConnectedClient): Promise<void> {
    await client.close();
    await picoAgentShutdown(client.app).completed;
}

function newSession(client: ConnectedClient, cwd: string) {
    return outcome(client.agent.request("session/new", { cwd, mcpServers: [] }));
}

function resume(client: ConnectedClient, sessionId: string, cwd: string) {
    return outcome(client.agent.request("session/resume", { sessionId, cwd }));
}

function list(client: ConnectedClient, params: ListSessionsRequest = {}) {
    return outcome(client.agent.request("session/list", params));
}

function prompt(client: ConnectedClient, sessionId: string, text: string) {
    return outcome(
        client.agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }),
    );
}

// ── Reading what Pico stored ─────────────────────────────────────────────────

/** Every journal directly inside a bucket of `root`, sorted; `[]` when the root does not exist. */
function journals(root: string): string[] {
    const found: string[] = [];
    for (const bucket of entriesOf(root)) {
        const directory = path.join(root, bucket);
        if (!fs.statSync(directory).isDirectory()) continue;
        for (const name of entriesOf(directory)) {
            if (name.endsWith(".jsonl")) found.push(path.join(directory, name));
        }
    }
    return found.sort();
}

/**
 * The one journal Pico saved, named before a test disturbs it, so a test that
 * changes a file's permissions or content fails for missing persistence rather
 * than for a path that was never written.
 */
function savedJournal(root: string): string {
    const stored = journals(root);
    assert.equal(stored.length, 1, `Pico saved no journal under ${root}`);
    return stored[0]!;
}

function entriesOf(directory: string): string[] {
    try {
        return fs.readdirSync(directory).sort();
    } catch {
        return [];
    }
}

interface Header {
    id: string;
    cwd: string;
    title?: string;
    version?: number;
}

/** The session header of a journal, which a title slot can precede. */
function header(file: string): Header {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.startsWith("{")) continue;
        const entry = JSON.parse(line) as { type?: string };
        if (entry.type === "session") return entry as unknown as Header;
    }
    assert.fail(`${file} holds no session header`);
}

/** Every file below `directory`, for proving Pico wrote nothing into OMP's own state. */
function filesUnder(directory: string): string[] {
    const found: string[] = [];
    for (const name of entriesOf(directory)) {
        const entry = path.join(directory, name);
        if (fs.statSync(entry).isDirectory()) found.push(...filesUnder(entry));
        else found.push(entry);
    }
    return found;
}

// ── Journals a test plants itself ────────────────────────────────────────────

interface PlantedJournal {
    id: string;
    file: string;
}

/**
 * A Pico-format journal in `root`'s bucket for `cwd`, written through the same public SDK
 * route Pico uses, so listing and reopening meet files this process never attached.
 */
async function plant(
    root: string,
    cwd: string,
    options: {
        title?: string;
        modified?: Date;
        entries?: (manager: SessionManager) => void;
    } = {},
): Promise<PlantedJournal> {
    const sessionDir = sessionDirForCwd(cwd, root);
    fs.mkdirSync(sessionDir, { recursive: true });
    const source = Sessions.inMemory(cwd);
    if (options.title) await source.setSessionName(options.title, "user");
    const manager = await source.persistCopy({ sessionDir, suppressBreadcrumb: true });
    options.entries?.(manager);
    await manager.flush();
    const file = manager.getSessionFile();
    assert.ok(file, "the planted journal was not written");
    const planted = { id: manager.getSessionId(), file };
    await manager.close();
    if (options.modified) fs.utimesSync(file, options.modified, options.modified);
    return planted;
}

type AppendedMessage = Parameters<SessionManager["appendMessage"]>[0];

/** The tail a process that died mid-tool-call leaves: a call with no result and no exit record. */
function interruptedTail(toolCallId: string, file: string) {
    return (manager: SessionManager) => {
        manager.appendMessage({
            role: "user",
            content: [{ type: "text", text: "Write the note." }],
            timestamp: Date.now(),
        } as AppendedMessage);
        manager.appendMessage({
            role: "assistant",
            content: [
                {
                    type: "toolCall",
                    id: toolCallId,
                    name: "write",
                    arguments: { path: file, content: "written by the replayed call\n" },
                },
            ],
            api: "pico-test",
            provider: "pico-test",
            model: "alpha",
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: Date.now(),
        } as AppendedMessage);
    };
}

/** Messages of one role on a journal's only branch. */
function messages(file: string, role: string): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.startsWith("{")) continue;
        const entry = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
        if (entry.type === "message" && entry.message?.role === role) found.push(entry.message);
    }
    return found;
}

// ── Generated samples ────────────────────────────────────────────────────────

/** A deterministic generator: the same seed yields the same samples on every run. */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function pick<T>(random: () => number, values: readonly T[]): T {
    return values[Math.min(values.length - 1, Math.floor(random() * values.length))]!;
}

function generatedUuid(random: () => number): string {
    const hex = (count: number) =>
        Array.from({ length: count }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("");
    return `${hex(8)}-${hex(4)}-7${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Identifiers no journal can be named by: Pico mints UUIDs, so each of these is a bad parameter. */
function generatedNonIdentifiers(random: () => number, real: string): string[] {
    const samples = new Set<string>(["", " ", ".", "..", "/", real.replaceAll("-", "")]);
    const decorations = [
        (value: string) => `../${value}`,
        (value: string) => `${value}/../${value}`,
        (value: string) => `/tmp/${value}.jsonl`,
        (value: string) => `${value}.jsonl`,
        (value: string) => `${value}\u0000`,
        (value: string) => `${value}\n`,
        (value: string) => value.slice(0, 1 + Math.floor(random() * 8)),
        (value: string) => `${value}${value}`,
        (value: string) => value.replace("-", "g"),
        (value: string) => `  ${value}  `,
        (value: string) => value.toUpperCase().replace(/[0-9A-F]/, "Ω"),
        () => "x".repeat(200 + Math.floor(random() * 100)),
    ];
    while (samples.size < 24) {
        samples.add(pick(random, decorations)(pick(random, [real, generatedUuid(random)])));
    }
    return [...samples];
}

describe("proposal.0004 Pico owns the conversations it stores", () => {
    test("a new session's journal and identity live only in Pico's storage", async t => {
        const f = await fixture(t);
        const client = await f.connect();

        const created = succeeded(await newSession(client, f.cwd));
        const stored = journals(f.sessionsRoot);
        assert.equal(stored.length, 1);
        assert.equal(path.dirname(stored[0]!), sessionDirForCwd(f.cwd, f.sessionsRoot));
        assert.deepEqual(
            { id: header(stored[0]!).id, cwd: header(stored[0]!).cwd },
            { id: created.sessionId, cwd: f.cwd },
        );
        assert.deepEqual(journals(getSessionsDir()), []);
        // A breadcrumb or custom-session record would name the journal, making
        // this conversation the terminal's current OMP session.
        const terminalState = filesUnder(f.agentDir).filter(file => {
            try {
                return fs.readFileSync(file, "utf8").includes(stored[0]!);
            } catch {
                // A credential store Pico cannot read is not evidence that it wrote one.
                return false;
            }
        });
        assert.deepEqual(terminalState, []);
    });

    test("an unprompted session created in one connection is listed and resumed by the next", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        const file = savedJournal(f.sessionsRoot);
        await disconnect(first);

        const second = await f.connect();
        const listed = succeeded(await list(second));
        assert.deepEqual(
            listed.sessions.map(session => ({ sessionId: session.sessionId, cwd: session.cwd })),
            [{ sessionId: created.sessionId, cwd: f.cwd }],
        );
        assert.match(String(listed.sessions[0]?.updatedAt), /^\d{4}-\d{2}-\d{2}T/);

        succeeded(await resume(second, created.sessionId, f.cwd));
        assert.deepEqual(journals(f.sessionsRoot), [file]);
        assert.equal(header(file).id, created.sessionId);

        const next = succeeded(await newSession(second, f.cwd));
        assert.notEqual(next.sessionId, created.sessionId);
        assert.equal(journals(f.sessionsRoot).length, 2);
    });

    test("an identifier is validated as an identity before anything is looked up", async t => {
        const f = await fixture(t);
        const client = await f.connect();
        const created = succeeded(await newSession(client, f.cwd));
        const before = journals(f.sessionsRoot).map(file => fs.readFileSync(file, "utf8"));
        const random = seeded(0x5e_55_10_17);

        for (const sample of generatedNonIdentifiers(random, created.sessionId)) {
            const error = rejected(await resume(client, sample, f.cwd));
            assert.equal(error.code, INVALID_PARAMS, `"${sample}" was not rejected as a parameter`);
        }
        for (let attempt = 0; attempt < 16; attempt++) {
            const unknown = generatedUuid(random);
            const error = rejected(await resume(client, unknown, f.cwd));
            assert.equal(error.code, SESSION_NOT_FOUND, `"${unknown}" was not reported missing`);
            assert.ok(error.data && typeof error.data === "object" && "sessionId" in error.data);
            assert.equal(error.data.sessionId, unknown);
        }
        assert.deepEqual(
            journals(f.sessionsRoot).map(file => fs.readFileSync(file, "utf8")),
            before,
        );
    });

    test("reopening requires the working directory the journal recorded", async t => {
        const f = await fixture(t);
        const elsewhere = temporaryDirectory(t, "elsewhere");
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        await disconnect(first);

        const second = await f.connect();
        const moved = rejected(await resume(second, created.sessionId, elsewhere));
        assert.equal(moved.code, INVALID_PARAMS);
        assert.ok(moved.message.includes(elsewhere), moved.message);
        assert.equal(
            rejected(await resume(second, created.sessionId, "relative")).code,
            INVALID_PARAMS,
        );
        assert.equal(
            rejected(await resume(second, created.sessionId, path.join(f.cwd, "missing"))).code,
            INVALID_PARAMS,
        );
        assert.equal(f.state.factoryCalls, 1);
        succeeded(await resume(second, created.sessionId, f.cwd));
    });

    test("a journal linked in from outside Pico's root is never opened", async t => {
        const f = await fixture(t);
        const outside = temporaryDirectory(t, "outside");
        const planted = await plant(outside, f.cwd, { title: "not Pico's" });
        const bucket = sessionDirForCwd(f.cwd, f.sessionsRoot);
        fs.mkdirSync(bucket, { recursive: true });
        const link = path.join(bucket, path.basename(planted.file));
        fs.symlinkSync(planted.file, link);
        const before = fs.readFileSync(planted.file, "utf8");

        const client = await f.connect();
        const error = rejected(await resume(client, planted.id, f.cwd));
        assert.notEqual(error.code, 0);
        assert.match(error.message, new RegExp(planted.id));
        assert.equal(fs.readFileSync(planted.file, "utf8"), before);
        assert.equal(f.state.factoryCalls, 0);
    });

    test("one identifier stored twice is refused rather than guessed", async t => {
        const f = await fixture(t);
        const other = temporaryDirectory(t, "twin");
        const planted = await plant(f.sessionsRoot, f.cwd);
        const twinBucket = sessionDirForCwd(other, f.sessionsRoot);
        fs.mkdirSync(twinBucket, { recursive: true });
        const twin = path.join(twinBucket, path.basename(planted.file));
        fs.copyFileSync(planted.file, twin);
        const before = journals(f.sessionsRoot).map(file => fs.readFileSync(file, "utf8"));

        const client = await f.connect();
        const error = rejected(await resume(client, planted.id, f.cwd));
        assert.equal(error.code, INVALID_PARAMS);
        assert.match(error.message, new RegExp(planted.id));
        assert.deepEqual(
            journals(f.sessionsRoot).map(file => fs.readFileSync(file, "utf8")),
            before,
        );
        assert.equal(f.state.factoryCalls, 0);
    });

    test("a damaged or unsupported journal fails with its identifier and cause", async t => {
        const f = await fixture(t);
        const damaged = await plant(f.sessionsRoot, f.cwd);
        const unsupported = await plant(f.sessionsRoot, f.cwd);
        fs.appendFileSync(damaged.file, "{this is not a session record\n");
        const future = header(unsupported.file);
        fs.writeFileSync(unsupported.file, `${JSON.stringify({ ...future, version: 99 })}\n`);

        const client = await f.connect();
        const broken = rejected(await resume(client, damaged.id, f.cwd));
        assert.match(broken.message, new RegExp(damaged.id));
        const newer = rejected(await resume(client, unsupported.id, f.cwd));
        assert.match(newer.message, /99/);
        assert.equal(journals(f.sessionsRoot).length, 2);
        assert.equal(f.state.factoryCalls, 0);
    });

    test("a live attachment is never forked, and a closed one reopens", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        const file = savedJournal(f.sessionsRoot);

        const second = await f.connect();
        const contested = rejected(await resume(second, created.sessionId, f.cwd));
        assert.match(contested.message, /busy|in use|already/i);
        assert.deepEqual(journals(f.sessionsRoot), [file]);

        await disconnect(first);
        succeeded(await resume(second, created.sessionId, f.cwd));
        assert.deepEqual(journals(f.sessionsRoot), [file]);
        assert.equal(header(file).id, created.sessionId);
    });

    test("an interrupted tail is closed once and its tool never runs again", async t => {
        const f = await fixture(t);
        const written = path.join(f.cwd, "note.txt");
        const planted = await plant(f.sessionsRoot, f.cwd, {
            entries: interruptedTail("stalled-write", written),
        });

        const first = await f.connect();
        succeeded(await resume(first, planted.id, f.cwd));
        await disconnect(first);
        const recovered = {
            user: messages(planted.file, "user").length,
            assistant: messages(planted.file, "assistant").length,
            results: messages(planted.file, "toolResult").map(message => message.toolCallId),
            aborted: messages(planted.file, "assistant").filter(
                message => message.stopReason === "aborted",
            ).length,
        };
        assert.deepEqual(recovered, {
            user: 1,
            assistant: 2,
            results: ["stalled-write"],
            aborted: 1,
        });

        const second = await f.connect();
        succeeded(await resume(second, planted.id, f.cwd));
        await disconnect(second);
        assert.deepEqual(
            {
                user: messages(planted.file, "user").length,
                assistant: messages(planted.file, "assistant").length,
                results: messages(planted.file, "toolResult").map(message => message.toolCallId),
                aborted: messages(planted.file, "assistant").filter(
                    message => message.stopReason === "aborted",
                ).length,
            },
            recovered,
        );
        assert.equal(fs.existsSync(written), false);
        assert.equal(f.models.alpha.calls.length, 0);
    });

    test("listing covers Pico's root only and keeps a session whose project is gone", async t => {
        const f = await fixture(t);
        // A project directory this test removes, so no fixture cleanup outlives it.
        const gone = path.join(temporaryDirectory(t, "projects"), "removed");
        fs.mkdirSync(gone);
        const mine = await plant(f.sessionsRoot, f.cwd, { title: "Pico's own" });
        const orphan = await plant(f.sessionsRoot, gone, { title: "a removed project" });
        const terminal = await plant(getSessionsDir(), f.cwd, { title: "a terminal session" });
        fs.rmSync(gone, { recursive: true, force: true });

        const client = await f.connect();
        const listed = succeeded(await list(client));
        assert.deepEqual(
            [...listed.sessions].map(session => session.sessionId).sort(),
            [mine.id, orphan.id].sort(),
        );
        assert.equal(listed.sessions.find(session => session.sessionId === orphan.id)?.cwd, gone);
        assert.equal(
            listed.sessions.find(session => session.sessionId === mine.id)?.title,
            "Pico's own",
        );
        assert.ok(!listed.sessions.some(session => session.sessionId === terminal.id));
        assert.equal(listed.nextCursor ?? undefined, undefined);
        assert.equal(f.state.factoryCalls, 0);
    });

    test("listing pages fifty by update time behind a cursor bound to its filter", async t => {
        const f = await fixture(t);
        const other = temporaryDirectory(t, "second-project");
        const random = seeded(0xc0ffee);
        const minute = 60_000;
        const base = Date.UTC(2026, 0, 1);
        const expected: { id: string; at: number }[] = [];
        for (let index = 0; index < 57; index++) {
            // Several sessions share a minute, so the identifier tie-break is exercised.
            const at = base + Math.floor(random() * 12) * minute;
            const planted = await plant(f.sessionsRoot, f.cwd, { modified: new Date(at) });
            expected.push({ id: planted.id, at });
        }
        for (let index = 0; index < 5; index++) {
            await plant(f.sessionsRoot, other, { modified: new Date(base + 99 * minute) });
        }
        const order = [...expected]
            // Code point order, not collation: a locale that ignores "-" would reorder identifiers.
            .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map(entry => entry.id);

        const client = await f.connect();
        const unfiltered = succeeded(await list(client));
        assert.equal(unfiltered.sessions.length, 50);
        assert.ok(unfiltered.nextCursor);

        const first = succeeded(await list(client, { cwd: f.cwd }));
        assert.equal(first.sessions.length, 50);
        assert.ok(first.nextCursor);
        const second = succeeded(await list(client, { cwd: f.cwd, cursor: first.nextCursor }));
        assert.equal(second.sessions.length, 7);
        assert.equal(second.nextCursor ?? undefined, undefined);
        assert.deepEqual(
            [...first.sessions, ...second.sessions].map(session => session.sessionId),
            order,
        );

        const crossed = rejected(await list(client, { cursor: first.nextCursor }));
        assert.equal(crossed.code, INVALID_PARAMS);
        const swapped = rejected(await list(client, { cwd: other, cursor: first.nextCursor }));
        assert.equal(swapped.code, INVALID_PARAMS);
    });

    test("malformed or incompatible cursors are refused rather than restarting the listing", async t => {
        const f = await fixture(t);
        await plant(f.sessionsRoot, f.cwd);
        const client = await f.connect();
        const issued = succeeded(await list(client));
        assert.equal(issued.sessions.length, 1);
        const random = seeded(0xbadc0de);

        const samples = ["", " ", "0", "null", "{}", Buffer.from("{}").toString("base64")];
        for (let attempt = 0; attempt < 12; attempt++) {
            samples.push(
                Buffer.from(
                    JSON.stringify({ v: Math.floor(random() * 9), k: generatedUuid(random) }),
                ).toString("base64"),
            );
            samples.push("\u0000".repeat(1 + Math.floor(random() * 4)) + generatedUuid(random));
        }
        for (const cursor of samples) {
            const error = rejected(await list(client, { cursor }));
            assert.equal(error.code, INVALID_PARAMS, `"${cursor}" was accepted`);
        }
    });

    test("an unreadable journal or bucket is reported instead of an empty history", async t => {
        const f = await fixture(t);
        const planted = await plant(f.sessionsRoot, f.cwd);
        const bucket = path.dirname(planted.file);
        const damaged = path.join(bucket, "0000_not-a-journal.jsonl");
        fs.writeFileSync(damaged, "this is not a session record\n");

        const client = await f.connect();
        const unreadable = rejected(await list(client));
        assert.ok(unreadable.message.includes(path.basename(damaged)), unreadable.message);

        fs.rmSync(damaged);
        succeeded(await list(client));
        fs.chmodSync(bucket, 0o000);
        const blocked = await list(client);
        fs.chmodSync(bucket, 0o700);
        const error = rejected(blocked);
        assert.ok(error.message.includes(path.basename(bucket)), error.message);
    });

    test("a failed save is reported, latched, and cleared only by reopening", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        succeeded(await prompt(first, created.sessionId, "Remember the recovery word."));
        const bucket = path.dirname(savedJournal(f.sessionsRoot));

        fs.chmodSync(bucket, 0o500);
        const failed = await prompt(first, created.sessionId, "Save this while the store is shut.");
        const latched = await prompt(first, created.sessionId, "And this one too.");
        fs.chmodSync(bucket, 0o700);
        assert.match(rejected(failed).message, /sav|persist|storage/i);
        assert.match(rejected(latched).message, /sav|persist|storage/i);
        await disconnect(first);

        const second = await f.connect();
        succeeded(await resume(second, created.sessionId, f.cwd));
        succeeded(await prompt(second, created.sessionId, "The store works again."));
    });

    test("a journal that is no longer this session's fails instead of forking it", async t => {
        const f = await fixture(t);
        const foreign = temporaryDirectory(t, "foreign");
        const planted = await plant(foreign, f.cwd, { title: "someone else's" });
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        const file = savedJournal(f.sessionsRoot);
        assert.equal(header(file).id, created.sessionId);

        fs.writeFileSync(file, fs.readFileSync(planted.file, "utf8"));
        const error = rejected(
            await prompt(first, created.sessionId, "Write into the wrong file."),
        );
        assert.match(error.message, new RegExp(created.sessionId));
        assert.equal(header(file).id, planted.id);
        assert.equal(messages(file, "user").length, 0);
    });

    test("a session that cannot start leaves no saved conversation", async t => {
        const f = await fixture(t);
        const client = await f.connect();
        f.state.factoryFailure = "the configured model is unavailable";

        const error = rejected(await newSession(client, f.cwd));
        assert.match(error.message, /the configured model is unavailable/);
        assert.deepEqual(journals(f.sessionsRoot), []);

        f.state.factoryFailure = undefined;
        succeeded(await newSession(client, f.cwd));
        assert.equal(journals(f.sessionsRoot).length, 1);
    });

    test("a failed reopen keeps the conversation it could not attach", async t => {
        const f = await fixture(t);
        const first = await f.connect();
        const created = succeeded(await newSession(first, f.cwd));
        succeeded(await prompt(first, created.sessionId, "Remember chestnut."));
        const file = savedJournal(f.sessionsRoot);
        await disconnect(first);

        const second = await f.connect();
        f.state.factoryFailure = "the configured model is unavailable";
        rejected(await resume(second, created.sessionId, f.cwd));
        assert.deepEqual(journals(f.sessionsRoot), [file]);
        assert.equal(header(file).id, created.sessionId);
        assert.match(JSON.stringify(messages(file, "user")), /Remember chestnut\./);

        f.state.factoryFailure = undefined;
        succeeded(await resume(second, created.sessionId, f.cwd));
        const listed = succeeded(await list(second));
        assert.deepEqual(
            listed.sessions.map(session => session.sessionId),
            [created.sessionId],
        );
    });

    test("a bucket that links out of Pico's storage is refused, not written through", async t => {
        const f = await fixture(t);
        const outside = temporaryDirectory(t, "outside-root");
        const planted = await plant(outside, f.cwd, { title: "not Pico's" });
        const escape = path.dirname(planted.file);
        fs.mkdirSync(f.sessionsRoot, { recursive: true });
        const bucket = sessionDirForCwd(f.cwd, f.sessionsRoot);
        fs.symlinkSync(escape, bucket);
        const before = fs.readdirSync(escape).sort();

        const client = await f.connect();
        const created = rejected(await newSession(client, f.cwd));
        assert.ok(created.message.includes(path.basename(bucket)), created.message);

        const reopened = rejected(await resume(client, planted.id, f.cwd));
        assert.notEqual(reopened.code, SESSION_NOT_FOUND);
        assert.ok(reopened.message.includes(path.basename(bucket)), reopened.message);

        const listed = rejected(await list(client));
        assert.ok(listed.message.includes(path.basename(bucket)), listed.message);

        assert.deepEqual(fs.readdirSync(escape).sort(), before);
        assert.equal(f.state.factoryCalls, 0);
    });

    test("a session root that links out of the data directory is refused", async t => {
        const f = await fixture(t);
        const outside = temporaryDirectory(t, "outside-sessions");
        fs.symlinkSync(outside, f.sessionsRoot);

        const client = await f.connect();
        const created = rejected(await newSession(client, f.cwd));
        assert.ok(created.message.includes("sessions"), created.message);
        const listed = rejected(await list(client));
        assert.ok(listed.message.includes("sessions"), listed.message);

        assert.deepEqual(fs.readdirSync(outside), []);
        assert.equal(f.state.factoryCalls, 0);
    });
});
