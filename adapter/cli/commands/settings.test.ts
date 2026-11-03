import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import type { Cleanups } from "../../engine/testing/session-fixture.ts";
import type { PicoSettings } from "../../settings/settings-document.ts";
import type { CommandHandlers as Handlers } from "./handlers.ts";

import { builtInChoice, modelValue } from "../../engine/model-catalog.ts";
import { createPicoSession } from "../../engine/pico-session.ts";
import { savedDefaultForNewSession } from "../../engine/saved-default.ts";
import { picoWorkspace } from "../../engine/testing/session-fixture.ts";
import { configOptionsOf } from "../../server/config-options.ts";
import { DEFAULT_AUTO_BACKGROUND, revisionOf } from "../../settings/settings-document.ts";
import { settingsFilePath, writeSettings } from "../../settings/settings-store.ts";
import { settingsGetOutput, settingsUpdateOutput } from "../result-schemas.ts";
import { createCommandHandlers } from "./handlers.ts";
import { input, rejection, testHandlers } from "./testing.ts";

async function settingsGet(handlers: Handlers) {
    return settingsGetOutput.parse({ apiVersion: 1, ...(await handlers["settings get"](input())) });
}

async function update(handlers: Handlers, options: Record<string, string | boolean>) {
    return settingsUpdateOutput.parse({
        apiVersion: 1,
        ...(await handlers["settings update"](input(options))),
    });
}

function fileBytes(dataDir: string): string | undefined {
    const file = settingsFilePath(dataDir);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/** A saved default model and thinking level, with auto-background left unset. */
function savedDefault(defaultModel: string, defaultThinking: string): PicoSettings {
    return { defaultModel, defaultThinking, autoBackground: null };
}

/** Settings with nothing saved at all. */
function savedNothing(): PicoSettings {
    return { defaultModel: null, defaultThinking: null, autoBackground: null };
}

describe("proposal.0007 pico settings get", () => {
    test("with no file, nothing is saved and new sessions start on OMP's built-in choice", async t => {
        const { handlers, registry, dataDir } = await testHandlers(t);

        const result = await settingsGet(handlers);

        const builtIn = await builtInChoice(registry);
        assert.ok(builtIn);
        assert.equal(result.status, "missing");
        assert.equal(result.revision, "none");
        assert.equal(result.settingsFile, settingsFilePath(dataDir));
        assert.deepEqual(result.item, savedNothing());
        assert.deepEqual(result.effective, {
            defaultModel: modelValue(builtIn.model),
            defaultThinking: builtIn.thinking,
            source: "built-in",
            available: true,
            autoBackground: true,
        });
    });

    test("a saved default is reported with the file's revision and as usable", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));

        const result = await settingsGet(handlers);

        assert.equal(result.status, "valid");
        assert.equal(result.revision, revisionOf(fs.readFileSync(settingsFilePath(dataDir))));
        assert.deepEqual(result.item, savedDefault("pico-test/beta", "low"));
        assert.deepEqual(result.effective, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
            source: "settings",
            available: true,
            autoBackground: true,
        });
    });

    test("a saved default the catalog lacks, or a level its model does not offer, is unusable", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        writeSettings(dataDir, savedDefault("pico-test/gamma", "off"));
        assert.equal((await settingsGet(handlers)).effective?.available, false);

        writeSettings(dataDir, savedDefault("pico-test/alpha", "high"));
        assert.equal((await settingsGet(handlers)).effective?.available, false);
    });

    test("an invalid or newer file is reported with its problem and nothing else", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        fs.writeFileSync(settingsFilePath(dataDir), '{ "version": 1, "defaultModel": "a/b" }');
        const invalid = await settingsGet(handlers);
        fs.writeFileSync(settingsFilePath(dataDir), '{ "version": 3 }');
        const newer = await settingsGet(handlers);

        assert.equal(invalid.status, "invalid");
        assert.equal(newer.status, "unsupported");
        for (const result of [invalid, newer]) {
            assert.equal(result.item, null);
            assert.equal(result.effective, null);
            assert.ok("problem" in result && result.problem.length > 0);
        }
    });

    test("effective names the model a new session then starts on", async t => {
        const { handlers, registry, cwd, agentDir, dataDir, authStorage } = await testHandlers(t);
        const startedOn = async () => {
            const session = await createPicoSession({
                cwd,
                agentDir,
                dataDir,
                mcpServers: [],
                authStorage,
                modelRegistry: registry,
                startOn: savedDefaultForNewSession(dataDir),
            });
            t.after(() => session.dispose());
            const thinking = configOptionsOf(session.engine).find(entry => entry.id === "thinking");
            return {
                defaultModel: modelValue(session.engine.model!),
                defaultThinking: thinking?.currentValue,
            };
        };
        const effective = async () => {
            const reported = (await settingsGet(handlers)).effective;
            return {
                defaultModel: reported?.defaultModel,
                defaultThinking: reported?.defaultThinking,
            };
        };

        assert.deepEqual(await startedOn(), await effective());
        writeSettings(dataDir, savedDefault("pico-test/beta", "medium"));
        assert.deepEqual(await startedOn(), await effective());
    });
});

describe("proposal.0007 pico settings update", () => {
    test("saving a default writes the file and returns a receipt that reads back", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        const receipt = await update(handlers, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
        });

        assert.equal(receipt.dryRun, false);
        assert.equal(receipt.changed, true);
        assert.deepEqual(receipt.before, { revision: "none", item: savedNothing() });
        assert.deepEqual(receipt.after.item, savedDefault("pico-test/beta", "low"));
        assert.equal(
            receipt.after.revision,
            revisionOf(fs.readFileSync(settingsFilePath(dataDir))),
        );
        const read = await settingsGet(handlers);
        assert.equal(read.revision, receipt.after.revision);
        assert.deepEqual(read.item, receipt.after.item);
    });

    test("a model alone keeps a level it offers and otherwise takes its own default", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        writeSettings(dataDir, savedDefault("pico-test/alpha", "off"));
        const kept = await update(handlers, { defaultModel: "pico-test/beta" });
        assert.deepEqual(kept.after.item, savedDefault("pico-test/beta", "off"));

        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));
        const replaced = await update(handlers, { defaultModel: "pico-test/alpha" });
        assert.deepEqual(replaced.after.item, savedDefault("pico-test/alpha", "off"));
    });

    test("a model alone with nothing saved starts at its own default level", async t => {
        const { handlers } = await testHandlers(t);

        const receipt = await update(handlers, { defaultModel: "pico-test/beta" });

        assert.equal(receipt.after.item.defaultThinking, "high");
    });

    test("a level alone applies to the saved model", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));

        const receipt = await update(handlers, { defaultThinking: "medium" });

        assert.deepEqual(receipt.after.item, savedDefault("pico-test/beta", "medium"));
    });

    test("a level alone with no saved model is refused", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        const failure = await rejection(
            handlers,
            "settings update",
            input({ defaultThinking: "low" }),
        );

        assert.equal(failure.code, "FAILED_PRECONDITION");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a level a model without reasoning cannot use is refused with the one it offers", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));
        const before = fileBytes(dataDir);

        const failure = await rejection(
            handlers,
            "settings update",
            input({ defaultModel: "pico-test/alpha", defaultThinking: "auto" }),
        );

        assert.equal(failure.code, "INVALID_ARGUMENT");
        assert.equal(failure.details.argument, "--default-thinking");
        assert.deepEqual(failure.details.accepted, ["off"]);
        assert.equal(fileBytes(dataDir), before);
    });

    test("a model outside the catalog is not found and nothing is written", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        const failure = await rejection(
            handlers,
            "settings update",
            input({ defaultModel: "pico-test/gamma" }),
        );

        assert.equal(failure.code, "NOT_FOUND");
        assert.equal(failure.details.model, "pico-test/gamma");
        assert.equal(fileBytes(dataDir), undefined);
    });

    test("a dry run writes nothing and reports the revision the write produces", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        const change = { defaultModel: "pico-test/beta", defaultThinking: "low" };

        const preview = await update(handlers, { ...change, dryRun: true });
        assert.equal(fileBytes(dataDir), undefined);
        const saved = await update(handlers, change);

        assert.equal(preview.dryRun, true);
        assert.equal(preview.changed, true);
        assert.deepEqual(preview.after, saved.after);
    });

    test("--if-revision refuses a file that is not the one read", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));
        const current = revisionOf(fs.readFileSync(settingsFilePath(dataDir)));
        const before = fileBytes(dataDir);

        const stale = await rejection(
            handlers,
            "settings update",
            input({ defaultThinking: "high", ifRevision: `sha256:${"0".repeat(64)}` }),
        );
        const absent = await rejection(
            handlers,
            "settings update",
            input({ defaultThinking: "high", ifRevision: "none" }),
        );

        for (const failure of [stale, absent]) {
            assert.equal(failure.code, "CONFLICT");
            assert.equal(failure.retryable, true);
            assert.equal(failure.details.actual, current);
        }
        assert.equal(fileBytes(dataDir), before);
        const matched = await update(handlers, { defaultThinking: "high", ifRevision: current });
        assert.equal(matched.changed, true);
    });

    test("--if-revision none accepts a missing file", async t => {
        const { handlers } = await testHandlers(t);

        const receipt = await update(handlers, {
            defaultModel: "pico-test/alpha",
            ifRevision: "none",
        });

        assert.equal(receipt.changed, true);
    });

    test("making the same change twice writes nothing the second time", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        const change = { defaultModel: "pico-test/beta", defaultThinking: "low" };
        await update(handlers, change);
        const file = settingsFilePath(dataDir);
        const firstWrite = fs.statSync(file).mtimeMs;

        const again = await update(handlers, change);

        assert.equal(again.changed, false);
        assert.deepEqual(again.after, again.before);
        assert.equal(fs.statSync(file).mtimeMs, firstWrite);
    });

    test("an invalid file is refused and left as it was", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        fs.writeFileSync(settingsFilePath(dataDir), "not json");

        const failure = await rejection(
            handlers,
            "settings update",
            input({ defaultModel: "pico-test/alpha" }),
        );

        assert.equal(failure.code, "FAILED_PRECONDITION");
        assert.equal(failure.details.settingsFile, settingsFilePath(dataDir));
        assert.equal(typeof failure.details.problem, "string");
        assert.equal(fileBytes(dataDir), "not json");
    });

    test("a write that fails reports the cause and leaves the previous file", async t => {
        if (process.getuid?.() === 0) return;
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, savedDefault("pico-test/beta", "low"));
        const before = fileBytes(dataDir);
        fs.chmodSync(dataDir, 0o500);
        let failure;
        try {
            failure = await rejection(
                handlers,
                "settings update",
                input({ defaultModel: "pico-test/alpha" }),
            );
        } finally {
            fs.chmodSync(dataDir, 0o700);
        }

        assert.equal(failure.code, "IO_ERROR");
        assert.equal(failure.details.path, settingsFilePath(dataDir));
        assert.equal(fileBytes(dataDir), before);
    });
});

/** Handlers whose catalog cannot be opened, as when no credentials are usable. */
function handlersWithoutCatalog(t: Cleanups) {
    const workspace = picoWorkspace(t);
    const handlers = createCommandHandlers({
        dataDir: workspace.dataDir,
        openCatalog: () => assert.fail("the catalog must not be opened"),
    });
    return { ...workspace, handlers };
}

describe("proposal.0008 pico settings get reports autoBackground", () => {
    test("with nothing saved it is unset, and a session would use Pico's default", async t => {
        const { handlers } = await testHandlers(t);

        const result = await settingsGet(handlers);

        assert.equal(result.item?.autoBackground, null);
        assert.equal(result.effective?.autoBackground, DEFAULT_AUTO_BACKGROUND);
    });

    test("a saved value is reported in item and in effective", async t => {
        const { handlers, dataDir } = await testHandlers(t);

        for (const saved of [false, true]) {
            writeSettings(dataDir, {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: saved,
            });
            const result = await settingsGet(handlers);

            assert.equal(result.item?.autoBackground, saved);
            assert.equal(result.effective?.autoBackground, saved);
        }
    });

    test("an invalid file reports no effective value at all", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        fs.writeFileSync(settingsFilePath(dataDir), '{"version":1,"autoBackground":"on"}');

        const result = await settingsGet(handlers);

        assert.equal(result.status, "invalid");
        assert.equal(result.effective, null);
        assert.ok("problem" in result && result.problem.includes("$.autoBackground"));
    });
});

describe("proposal.0008 pico settings update --auto-background", () => {
    test("off alone is saved without a catalog, keeping the saved default model", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);
        writeSettings(dataDir, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
            autoBackground: null,
        });

        const receipt = await update(handlers, { autoBackground: "off" });

        assert.equal(receipt.changed, true);
        assert.deepEqual(receipt.after.item, {
            defaultModel: "pico-test/beta",
            defaultThinking: "low",
            autoBackground: false,
        });
        assert.equal(
            receipt.after.revision,
            revisionOf(fs.readFileSync(settingsFilePath(dataDir))),
        );
    });

    test("on alone is saved with no settings file and no catalog", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);

        const receipt = await update(handlers, { autoBackground: "on" });

        assert.deepEqual(receipt.after.item, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: true,
        });
        assert.equal(fileBytes(dataDir), '{\n    "version": 1,\n    "autoBackground": true\n}\n');
    });

    test("a model change keeps the saved value", async t => {
        const { handlers, dataDir } = await testHandlers(t);
        writeSettings(dataDir, {
            defaultModel: "pico-test/alpha",
            defaultThinking: "off",
            autoBackground: false,
        });

        const receipt = await update(handlers, { defaultModel: "pico-test/beta" });

        assert.equal(receipt.after.item.autoBackground, false);
    });

    test("a dry run writes nothing and reports what the write would produce", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);

        const preview = await update(handlers, { autoBackground: "off", dryRun: true });
        assert.equal(fileBytes(dataDir), undefined);
        const saved = await update(handlers, { autoBackground: "off" });

        assert.equal(preview.dryRun, true);
        assert.equal(preview.changed, true);
        assert.deepEqual(preview.after, saved.after);
    });

    test("--if-revision refuses a file that is not the one read", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);
        writeSettings(dataDir, {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: true,
        });
        const before = fileBytes(dataDir);

        const failure = await rejection(
            handlers,
            "settings update",
            input({ autoBackground: "off", ifRevision: "none" }),
        );

        assert.equal(failure.code, "CONFLICT");
        assert.equal(fileBytes(dataDir), before);
    });

    test("saving the state it already has changes nothing", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);
        await update(handlers, { autoBackground: "off" });
        const file = settingsFilePath(dataDir);
        const firstWrite = fs.statSync(file).mtimeMs;

        const again = await update(handlers, { autoBackground: "off" });

        assert.equal(again.changed, false);
        assert.deepEqual(again.after, again.before);
        assert.equal(fs.statSync(file).mtimeMs, firstWrite);
    });

    test("an invalid settings file is refused before anything is written", async t => {
        const { handlers, dataDir } = handlersWithoutCatalog(t);
        fs.writeFileSync(settingsFilePath(dataDir), "not json");

        const failure = await rejection(
            handlers,
            "settings update",
            input({ autoBackground: "on" }),
        );

        assert.equal(failure.code, "FAILED_PRECONDITION");
        assert.equal(fileBytes(dataDir), "not json");
    });
});
