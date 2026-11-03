import type { Api, Model } from "@oh-my-pi/pi-ai";

import { describe, expect, test } from "bun:test";

import { catalogEntry, defaultThinking, thinkingChoices } from "./model-catalog.ts";
import { createMockModel, createReasoningMockModel } from "./testing/session-fixture.ts";

function withLadder(efforts: string[]): Model<Api> {
    return {
        ...createMockModel({ id: "laddered" }),
        reasoning: true,
        thinking: { efforts },
    } as unknown as Model<Api>;
}

describe("proposal.0007 thinking choices for a model", () => {
    test("a model without reasoning offers Off and Auto", () => {
        expect(
            thinkingChoices(createMockModel({ id: "plain" })).map(choice => choice.value),
        ).toEqual(["off", "auto"]);
    });

    test("a reasoning model offers Off, Auto, then its levels in OMP's order", () => {
        const choices = thinkingChoices(createReasoningMockModel({ id: "thinker" }));
        expect(choices.map(choice => choice.value)).toEqual([
            "off",
            "auto",
            "low",
            "medium",
            "high",
        ]);
        expect(choices.slice(0, 2).map(choice => choice.name)).toEqual(["Off", "Auto"]);
    });

    test("the default level is Off for a model without reasoning", () => {
        expect(defaultThinking(createMockModel({ id: "plain" }))).toBe("off");
    });

    test("the default level is high when the model offers it", () => {
        expect(defaultThinking(createReasoningMockModel({ id: "thinker" }))).toBe("high");
    });

    test("the default level is the nearest level below high the model offers", () => {
        expect(defaultThinking(withLadder(["low", "medium"]))).toBe("medium");
    });

    test("the default level is the model's lowest when it offers nothing up to high", () => {
        expect(defaultThinking(withLadder(["xhigh", "max"]))).toBe("xhigh");
    });

    test("a reasoning model without a level ladder defaults to Off", () => {
        expect(defaultThinking(withLadder([]))).toBe("off");
    });

    test("the default level is always one of the model's choices", () => {
        const ladders = [
            [],
            ["low"],
            ["minimal", "max"],
            ["low", "medium", "high", "xhigh"],
            ["max"],
        ];
        for (const ladder of ladders) {
            const model = withLadder(ladder);
            const offered = thinkingChoices(model).map(choice => choice.value);
            expect(offered).toContain(defaultThinking(model));
        }
    });
});

describe("proposal.0007 catalog entries", () => {
    test("an entry carries the values Pico's Model and Thinking options send Sesh", () => {
        const model = createReasoningMockModel({ id: "thinker" });

        expect(catalogEntry(model)).toEqual({
            value: `${model.provider}/thinker`,
            name: model.name,
            provider: model.provider,
            thinking: [
                { value: "off", name: "Off" },
                { value: "auto", name: "Auto" },
                { value: "low", name: "low" },
                { value: "medium", name: "medium" },
                { value: "high", name: "high" },
            ],
            defaultThinking: "high",
        });
    });
});
