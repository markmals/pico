import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogEntry, loadCatalog, modelValue } from "../../engine/model-catalog.ts";
import { modelsGetOutput, modelsListOutput } from "../result-schemas.ts";
import { input, rejection, testHandlers } from "./testing.ts";

describe("proposal.0007 pico models", () => {
    test("models list prints the catalog, each model with its thinking choices", async t => {
        const { handlers, registry } = await testHandlers(t);

        const result = modelsListOutput.parse({
            apiVersion: 1,
            ...(await handlers["models list"](input())),
        });

        const expected = (await loadCatalog(registry)).map(catalogEntry);
        assert.deepEqual(result.items, expected);
        assert.ok(result.items.some(item => item.value === "pico-test/beta"));
        assert.deepEqual(result.providerCredentials, {});
    });

    test("--provider keeps one provider's models, and an unknown one keeps none", async t => {
        const { handlers } = await testHandlers(t);

        const kept = modelsListOutput.parse({
            apiVersion: 1,
            ...(await handlers["models list"](input({ provider: "pico-test" }))),
        });
        const none = modelsListOutput.parse({
            apiVersion: 1,
            ...(await handlers["models list"](input({ provider: "no-such-provider" }))),
        });

        assert.deepEqual(kept.items.map(item => item.value).toSorted(), [
            "pico-test/alpha",
            "pico-test/beta",
        ]);
        assert.deepEqual(none.items, []);
    });

    test("models get prints one model", async t => {
        const { handlers, registry } = await testHandlers(t);

        const result = modelsGetOutput.parse({
            apiVersion: 1,
            ...(await handlers["models get"](input({}, { model: "pico-test/beta" }))),
        });

        const beta = (await loadCatalog(registry)).find(
            model => modelValue(model) === "pico-test/beta",
        );
        assert.ok(beta);
        assert.deepEqual(result.item, catalogEntry(beta));
    });

    test("a model outside the catalog is not found, naming it and where to look", async t => {
        const { handlers } = await testHandlers(t);

        const failure = await rejection(
            handlers,
            "models get",
            input({}, { model: "pico-test/gamma" }),
        );

        assert.equal(failure.code, "NOT_FOUND");
        assert.match(failure.message, /pico-test\/gamma/);
        assert.equal(failure.details.model, "pico-test/gamma");
        assert.equal(failure.details.alternatives, "pico models list");
    });
});
