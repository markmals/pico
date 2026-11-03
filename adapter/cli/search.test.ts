import { describe, expect, test } from "bun:test";

import { findCommand, usageOf } from "./command.ts";
import { searchOutput } from "./result-schemas.ts";
import { searchCommands } from "./search.ts";

describe("proposal.0007 cli search", () => {
    test.each([
        ["change the default model", "settings update"],
        ["which models can I use", "models list"],
        ["what model do new sessions start with", "settings get"],
    ])("%p ranks %p first", (query: string, expected: string) => {
        const result = searchCommands(query);

        expect(result.items[0]?.command).toBe(expected);
    });

    test("an item carries the command, its summary and its usage", () => {
        const [first] = searchCommands("change the default model").items;

        expect(first).toEqual({
            command: "settings update",
            summary:
                "Change the default model or thinking level, and whether slow commands move to the background",
            usage: usageOf(findCommand(["settings", "update"]) as never),
        });
    });

    test("a query that matches nothing returns an empty list", () => {
        const result = searchCommands("xylophone quokka");

        expect(result).toEqual({ apiVersion: 1, query: "xylophone quokka", items: [] });
    });

    test("a query of nothing but filler words matches nothing", () => {
        expect(searchCommands("the a of to").items).toEqual([]);
    });

    test("at most five commands are returned", () => {
        const result = searchCommands("schema search models settings thinking file command");

        expect(result.items.length).toBe(5);
    });

    test("case and accents are ignored", () => {
        const plain = searchCommands("change the default model");
        const accented = searchCommands("CHÁNGE THE DÉFAULT MÓDEL");

        expect(accented.items.map(item => item.command)).toEqual(
            plain.items.map(item => item.command),
        );
    });

    test("commands that match equally keep their registry order", () => {
        expect(searchCommands("settings").items.map(item => item.command)).toEqual([
            "settings get",
            "settings update",
        ]);
    });

    test("a query word matches the start of a word, not its middle", () => {
        expect(searchCommands("odel").items).toEqual([]);
    });

    test("every result validates against the declared output schema", () => {
        for (const query of ["change the default model", "nothing matches this", "settings"]) {
            const parsed = searchOutput.safeParse(searchCommands(query));

            expect({ query, valid: parsed.success }).toEqual({ query, valid: true });
        }
    });
});

describe("proposal.0008 finding the auto-background option", () => {
    test.each([
        ["stop slow bash commands going to the background", "settings update"],
        ["background job", "settings update"],
        ["turn auto background off", "settings update"],
    ])("%p ranks %p first", (query: string, expected: string) => {
        expect(searchCommands(query).items[0]?.command).toBe(expected);
    });

    test("background alone finds both the command that shows it and the one that changes it", () => {
        expect(searchCommands("background").items.map(item => item.command)).toEqual([
            "settings get",
            "settings update",
        ]);
    });
});

describe("proposal.0009 finding how to connect a provider", () => {
    test.each([
        ["sign in to a provider", "auth login"],
        ["store an api key", "credentials create"],
        ["which providers can I connect", "providers list"],
        ["stop using a credential for a provider", "providers update"],
    ])("%p ranks %p first", (query: string, expected: string) => {
        expect(searchCommands(query).items[0]?.command).toBe(expected);
    });

    test.each([
        ["forget a credential", "credentials delete"],
        ["list the credentials pico stored", "credentials list"],
        ["check that a credential still works", "credentials get"],
    ])("%p ranks %p first", (query: string, expected: string) => {
        expect(searchCommands(query).items[0]?.command).toBe(expected);
    });
});
