import { describe, expect, test } from "bun:test";

import type { SettingsState } from "./settings-document.ts";

import {
    DEFAULT_AUTO_BACKGROUND,
    readSettingsState,
    revisionOf,
    serializeSettings,
} from "./settings-document.ts";

function documentBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/** The problem of a state that should carry one, as something a failed assertion can print. */
function problemOf(state: SettingsState): string {
    return "problem" in state ? state.problem : `the ${state.status} state carries no problem`;
}

const WITH_DEFAULT = documentBytes(
    '{"version":1,"defaultModel":"anthropic/claude-sonnet-5-5","defaultThinking":"high"}',
);

describe("proposal.0007 settings file states", () => {
    test("no file is missing, with no revision and no saved default", () => {
        expect(readSettingsState(undefined)).toEqual({
            status: "missing",
            revision: "none",
            item: { defaultModel: null, defaultThinking: null, autoBackground: null },
        });
    });

    test("a version 1 document with the pair is valid and carries both values", () => {
        expect(readSettingsState(WITH_DEFAULT)).toEqual({
            status: "valid",
            revision: revisionOf(WITH_DEFAULT),
            item: {
                defaultModel: "anthropic/claude-sonnet-5-5",
                defaultThinking: "high",
                autoBackground: null,
            },
        });
    });

    test("a version 1 document without the pair is valid with two null values", () => {
        expect(readSettingsState(documentBytes('{"version":1}'))).toEqual({
            status: "valid",
            revision: "sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8",
            item: { defaultModel: null, defaultThinking: null, autoBackground: null },
        });
    });

    test("an object with a later version is unsupported, naming the version and a newer Pico", () => {
        const document = documentBytes('{"version":2,"defaultModel":"a/b","mood":"new"}');

        const state = readSettingsState(document);

        expect(state.status).toBe("unsupported");
        expect(problemOf(state)).toContain("2");
        expect(problemOf(state)).toContain("newer version of Pico");
        expect(state.revision).toBe(revisionOf(document));
    });

    test("an invalid file still reports its revision, so a reader can quote the file it read", () => {
        expect(readSettingsState(documentBytes("[]")).revision).toBe(
            "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        );
    });
});

const INVALID_DOCUMENTS: Array<{ what: string; document: Uint8Array; path: string }> = [
    { what: "bytes that are not UTF-8", document: Uint8Array.of(0x7b, 0xff, 0x7d), path: "$" },
    { what: "text that is not JSON", document: documentBytes("{ version: 1 "), path: "$" },
    { what: "an array", document: documentBytes("[]"), path: "$" },
    { what: "a string", document: documentBytes('"settings"'), path: "$" },
    { what: "a number", document: documentBytes("42"), path: "$" },
    { what: "null", document: documentBytes("null"), path: "$" },
    {
        what: "an object with no version",
        document: documentBytes('{"defaultModel":"a/b","defaultThinking":"high"}'),
        path: "$.version",
    },
    { what: "a fractional version", document: documentBytes('{"version":1.5}'), path: "$.version" },
    {
        what: "a version written as text",
        document: documentBytes('{"version":"1"}'),
        path: "$.version",
    },
    { what: "version 0", document: documentBytes('{"version":0}'), path: "$.version" },
    {
        what: "a default model with no thinking level",
        document: documentBytes('{"version":1,"defaultModel":"a/b"}'),
        path: "$.defaultThinking",
    },
    {
        what: "a thinking level with no default model",
        document: documentBytes('{"version":1,"defaultThinking":"high"}'),
        path: "$.defaultModel",
    },
    {
        what: "an empty default model",
        document: documentBytes('{"version":1,"defaultModel":"","defaultThinking":"high"}'),
        path: "$.defaultModel",
    },
    {
        what: "a thinking level of the wrong type",
        document: documentBytes('{"version":1,"defaultModel":"a/b","defaultThinking":5}'),
        path: "$.defaultThinking",
    },
    {
        what: "a member version 1 does not define",
        document: documentBytes('{"version":1,"flavour":"spicy"}'),
        path: "$",
    },
];

describe("proposal.0007 settings file problems", () => {
    for (const { what, document, path } of INVALID_DOCUMENTS) {
        test(`${what} is invalid, and its problem names ${path}`, () => {
            const state = readSettingsState(document);

            expect(state.status).toBe("invalid");
            expect(problemOf(state)).toStartWith(`${path}: `);
        });
    }

    test("an unknown member's problem names the member", () => {
        const state = readSettingsState(documentBytes('{"version":1,"flavour":"spicy"}'));

        expect(problemOf(state)).toBe('$: unknown member "flavour"');
    });
});

describe("proposal.0007 serializing settings", () => {
    test("a saved default is written as version 1, indented by four spaces, with a trailing newline", () => {
        const text = serializeSettings({
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: null,
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 1,',
                '    "defaultModel": "anthropic/claude-sonnet-5-5",',
                '    "defaultThinking": "high"',
                "}",
                "",
            ].join("\n"),
        );
    });

    test("no saved default omits the pair", () => {
        expect(
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
            }),
        ).toBe('{\n    "version": 1\n}\n');
    });

    test("a model without its thinking level cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: "a/b",
                defaultThinking: null,
                autoBackground: null,
            }),
        ).toThrow();
    });

    test("a thinking level without its model cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: null,
                defaultThinking: "high",
                autoBackground: null,
            }),
        ).toThrow();
    });
});

describe("proposal.0007 settings revisions", () => {
    test("no file has the revision none", () => {
        expect(revisionOf(undefined)).toBe("none");
    });

    test("a file's revision is sha256: and the lowercase hex digest of its bytes", () => {
        expect(revisionOf(documentBytes("abc"))).toBe(
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });
});

describe("proposal.0008 the autoBackground setting", () => {
    test("Pico's own default is on", () => {
        expect(DEFAULT_AUTO_BACKGROUND).toBe(true);
    });

    test("a file holding only autoBackground is valid and carries it, on or off", () => {
        for (const saved of [true, false]) {
            const document = documentBytes(`{"version":1,"autoBackground":${saved}}`);

            expect(readSettingsState(document)).toEqual({
                status: "valid",
                revision: revisionOf(document),
                item: { defaultModel: null, defaultThinking: null, autoBackground: saved },
            });
        }
    });

    test("a file holding both the pair and autoBackground carries all three", () => {
        const document = documentBytes(
            '{"version":1,"defaultModel":"a/b","defaultThinking":"high","autoBackground":false}',
        );

        expect(readSettingsState(document)).toEqual({
            status: "valid",
            revision: revisionOf(document),
            item: { defaultModel: "a/b", defaultThinking: "high", autoBackground: false },
        });
    });

    test("a file that never set it, and no file at all, leave it unset", () => {
        const absent = readSettingsState(documentBytes('{"version":1}'));
        const missing = readSettingsState(undefined);

        expect([absent, missing].map(state => ("item" in state ? state.item : state))).toEqual([
            { defaultModel: null, defaultThinking: null, autoBackground: null },
            { defaultModel: null, defaultThinking: null, autoBackground: null },
        ]);
    });

    test("a value that is not a boolean is invalid, and its problem names the member", () => {
        for (const value of ['"on"', "1", "null", "[]", "{}"]) {
            const state = readSettingsState(
                documentBytes(`{"version":1,"autoBackground":${value}}`),
            );

            expect([value, state.status]).toEqual([value, "invalid"]);
            expect(problemOf(state)).toStartWith("$.autoBackground: ");
        }
    });

    test("a set value is written after the default model pair", () => {
        const text = serializeSettings({
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: false,
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 1,',
                '    "defaultModel": "anthropic/claude-sonnet-5-5",',
                '    "defaultThinking": "high",',
                '    "autoBackground": false',
                "}",
                "",
            ].join("\n"),
        );
    });

    test("an unset value is left out, so a file that never set it keeps proposal 0007's bytes", () => {
        const withDefault = serializeSettings({
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: null,
        });

        expect(withDefault).toBe(
            '{\n    "version": 1,\n    "defaultModel": "anthropic/claude-sonnet-5-5",\n    "defaultThinking": "high"\n}\n',
        );
        expect(
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
            }),
        ).toBe('{\n    "version": 1\n}\n');
    });

    test("it is saved without a default model, and reads back the same", () => {
        const item = { defaultModel: null, defaultThinking: null, autoBackground: true };
        const bytes = new TextEncoder().encode(serializeSettings(item));

        expect(new TextDecoder().decode(bytes)).toBe(
            '{\n    "version": 1,\n    "autoBackground": true\n}\n',
        );
        expect(readSettingsState(bytes)).toEqual({
            status: "valid",
            revision: revisionOf(bytes),
            item,
        });
    });
});
