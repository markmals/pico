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
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            },
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
                intellisensePath: null,
                providerCredentials: {},
            },
        });
    });

    test("a version 1 document without the pair is valid with two null values", () => {
        expect(readSettingsState(documentBytes('{"version":1}'))).toEqual({
            status: "valid",
            revision: "sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8",
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            },
        });
    });

    test("an object with a later version is unsupported, naming the version and a newer Pico", () => {
        const document = documentBytes('{"version":4,"defaultModel":"a/b","mood":"new"}');

        const state = readSettingsState(document);

        expect(state.status).toBe("unsupported");
        expect(problemOf(state)).toContain("4");
        expect(problemOf(state)).toContain("newer version of Pico");
        expect(state.revision).toBe(revisionOf(document));
    });

    test("an invalid file still reports its revision, so a reader can quote the file it read", () => {
        expect(readSettingsState(documentBytes("[]")).revision).toBe(
            "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        );
    });
});

describe("proposal.0009 provider credential bindings", () => {
    test("a version 2 document carries its bindings beside the saved default", () => {
        const document = documentBytes(
            '{"version":2,"defaultModel":"a/b","defaultThinking":"high",' +
                '"providerCredentials":{"openai-codex":"6f1c5f2e-0000-4000-8000-000000000001"}}',
        );

        expect(readSettingsState(document)).toEqual({
            status: "valid",
            revision: revisionOf(document),
            item: {
                defaultModel: "a/b",
                defaultThinking: "high",
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: { "openai-codex": "6f1c5f2e-0000-4000-8000-000000000001" },
            },
        });
    });

    test("a version 2 document without the map has no bindings, not a missing member", () => {
        const state = readSettingsState(documentBytes('{"version":2}'));

        expect(state).toEqual({
            status: "valid",
            revision: revisionOf(documentBytes('{"version":2}')),
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            },
        });
    });

    test("a version 2 document can bind credentials with no saved default model", () => {
        const document = documentBytes(
            '{"version":2,"providerCredentials":{"anthropic":"6f1c5f2e-0000-4000-8000-000000000002"}}',
        );

        const state = readSettingsState(document);

        expect(state.status).toBe("valid");
        expect("item" in state && state.item).toEqual({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: { anthropic: "6f1c5f2e-0000-4000-8000-000000000002" },
        });
    });

    test("a version 2 document binds several providers independently", () => {
        const document = documentBytes(
            '{"version":2,"providerCredentials":{"anthropic":"ref-a","openai":"ref-b"}}',
        );

        const state = readSettingsState(document);

        expect("item" in state && state.item.providerCredentials).toEqual({
            anthropic: "ref-a",
            openai: "ref-b",
        });
    });

    test("a version 1 document reads as valid with no bindings, so an older file still works", () => {
        const state = readSettingsState(WITH_DEFAULT);

        expect(state.status).toBe("valid");
        expect("item" in state && state.item.providerCredentials).toEqual({});
    });

    test("a version 1 document carrying bindings is invalid: version 1 does not define them", () => {
        const state = readSettingsState(
            documentBytes('{"version":1,"providerCredentials":{"anthropic":"ref-a"}}'),
        );

        expect(state.status).toBe("invalid");
        expect(problemOf(state)).toBe('$: unknown member "providerCredentials"');
    });

    test("a version 2 document carries bindings and the auto-background choice together", () => {
        const document = documentBytes(
            '{"version":2,"autoBackground":false,"providerCredentials":{"anthropic":"ref-a"}}',
        );

        expect(readSettingsState(document)).toEqual({
            status: "valid",
            revision: revisionOf(document),
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: false,
                intellisensePath: null,
                providerCredentials: { anthropic: "ref-a" },
            },
        });
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
    {
        what: "a member version 2 does not define",
        document: documentBytes('{"version":2,"flavour":"spicy"}'),
        path: "$",
    },
    {
        what: "a default model with no thinking level in version 2",
        document: documentBytes('{"version":2,"defaultModel":"a/b"}'),
        path: "$.defaultThinking",
    },
    {
        what: "bindings written as an array",
        document: documentBytes('{"version":2,"providerCredentials":[]}'),
        path: "$.providerCredentials",
    },
    {
        what: "bindings written as text",
        document: documentBytes('{"version":2,"providerCredentials":"anthropic"}'),
        path: "$.providerCredentials",
    },
    {
        what: "bindings written as null",
        document: documentBytes('{"version":2,"providerCredentials":null}'),
        path: "$.providerCredentials",
    },
    {
        what: "a binding naming no credential",
        document: documentBytes('{"version":2,"providerCredentials":{"anthropic":""}}'),
        path: "$.providerCredentials.anthropic",
    },
    {
        what: "a binding whose credential is not text",
        document: documentBytes('{"version":2,"providerCredentials":{"anthropic":7}}'),
        path: "$.providerCredentials.anthropic",
    },
    {
        what: "a binding whose credential is null",
        document: documentBytes('{"version":2,"providerCredentials":{"anthropic":null}}'),
        path: "$.providerCredentials.anthropic",
    },
    {
        what: "a binding whose credential is an object",
        document: documentBytes(
            '{"version":2,"providerCredentials":{"anthropic":{"reference":"ref-a"}}}',
        ),
        path: "$.providerCredentials.anthropic",
    },
    {
        what: "a binding naming no provider",
        document: documentBytes('{"version":2,"providerCredentials":{"":"ref-a"}}'),
        path: "$.providerCredentials",
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

describe("proposal.0009 serializing settings", () => {
    test("a saved default is written as version 3, indented by four spaces, with a trailing newline", () => {
        const text = serializeSettings({
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: {},
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 3,',
                '    "defaultModel": "anthropic/claude-sonnet-5-5",',
                '    "defaultThinking": "high"',
                "}",
                "",
            ].join("\n"),
        );
    });

    test("no saved default and no binding omits both", () => {
        expect(
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            }),
        ).toBe('{\n    "version": 3\n}\n');
    });

    test("bindings are written after the saved default", () => {
        const text = serializeSettings({
            defaultModel: "a/b",
            defaultThinking: "high",
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: { anthropic: "ref-a" },
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 3,',
                '    "defaultModel": "a/b",',
                '    "defaultThinking": "high",',
                '    "providerCredentials": {',
                '        "anthropic": "ref-a"',
                "    }",
                "}",
                "",
            ].join("\n"),
        );
    });

    test("bindings are written in a canonical provider order, so a revision does not depend on key order", () => {
        const one = serializeSettings({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: { openai: "ref-b", anthropic: "ref-a" },
        });
        const other = serializeSettings({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: { anthropic: "ref-a", openai: "ref-b" },
        });

        expect(one).toBe(other);
        expect(one.indexOf('"anthropic"')).toBeLessThan(one.indexOf('"openai"'));
    });

    test("saved bindings read back as themselves, beside the auto-background choice", () => {
        const item = {
            defaultModel: "a/b",
            defaultThinking: "high",
            autoBackground: true,
            intellisensePath: null,
            providerCredentials: { anthropic: "ref-a", "openai-codex": "ref-b" },
        };

        const state = readSettingsState(documentBytes(serializeSettings(item)));

        expect(state.status).toBe("valid");
        expect("item" in state && state.item).toEqual(item);
    });

    test("a model without its thinking level cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: "a/b",
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            }),
        ).toThrow();
    });

    test("a thinking level without its model cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: null,
                defaultThinking: "high",
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            }),
        ).toThrow();
    });

    test("a binding naming no credential cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: { anthropic: "" },
            }),
        ).toThrow();
    });

    test("a binding naming no provider cannot be serialized", () => {
        expect(() =>
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: { "": "ref-a" },
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
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: saved,
                    intellisensePath: null,
                    providerCredentials: {},
                },
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
            item: {
                defaultModel: "a/b",
                defaultThinking: "high",
                autoBackground: false,
                intellisensePath: null,
                providerCredentials: {},
            },
        });
    });

    test("a file that never set it, and no file at all, leave it unset", () => {
        const absent = readSettingsState(documentBytes('{"version":1}'));
        const missing = readSettingsState(undefined);

        expect([absent, missing].map(state => ("item" in state ? state.item : state))).toEqual([
            {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            },
            {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            },
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
            intellisensePath: null,
            providerCredentials: {},
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 3,',
                '    "defaultModel": "anthropic/claude-sonnet-5-5",',
                '    "defaultThinking": "high",',
                '    "autoBackground": false',
                "}",
                "",
            ].join("\n"),
        );
    });

    test("a set value is written before the provider bindings", () => {
        const text = serializeSettings({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: true,
            intellisensePath: null,
            providerCredentials: { anthropic: "ref-a" },
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 3,',
                '    "autoBackground": true,',
                '    "providerCredentials": {',
                '        "anthropic": "ref-a"',
                "    }",
                "}",
                "",
            ].join("\n"),
        );
    });

    test("an unset value is left out of the saved document", () => {
        const withDefault = serializeSettings({
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: {},
        });

        expect(withDefault).toBe(
            '{\n    "version": 3,\n    "defaultModel": "anthropic/claude-sonnet-5-5",\n    "defaultThinking": "high"\n}\n',
        );
        expect(
            serializeSettings({
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: null,
                providerCredentials: {},
            }),
        ).toBe('{\n    "version": 3\n}\n');
    });

    test("it is saved without a default model, and reads back the same", () => {
        const item = {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: true,
            intellisensePath: null,
            providerCredentials: {},
        };
        const bytes = new TextEncoder().encode(serializeSettings(item));

        expect(new TextDecoder().decode(bytes)).toBe(
            '{\n    "version": 3,\n    "autoBackground": true\n}\n',
        );
        expect(readSettingsState(bytes)).toEqual({
            status: "valid",
            revision: revisionOf(bytes),
            item,
        });
    });
});

describe("pico-bfk.20 the intellisense path", () => {
    test("a version 3 document carries the saved path", () => {
        const bytes = documentBytes(
            '{"version":3,"intellisensePath":"/opt/homebrew/bin/intellisense"}',
        );

        expect(readSettingsState(bytes)).toEqual({
            status: "valid",
            revision: revisionOf(bytes),
            item: {
                defaultModel: null,
                defaultThinking: null,
                autoBackground: null,
                intellisensePath: "/opt/homebrew/bin/intellisense",
                providerCredentials: {},
            },
        });
    });

    test("version 1 and version 2 files are still read, with no saved path", () => {
        for (const text of ['{"version":1}', '{"version":2,"providerCredentials":{"a":"b"}}']) {
            const state = readSettingsState(documentBytes(text));

            expect([text, state.status]).toEqual([text, "valid"]);
            expect("item" in state ? state.item.intellisensePath : "no item").toBeNull();
        }
    });

    test("a version 1 or 2 document that names the member is invalid", () => {
        for (const version of [1, 2]) {
            const state = readSettingsState(
                documentBytes(`{"version":${version},"intellisensePath":"/usr/bin/intellisense"}`),
            );

            expect([version, state.status]).toEqual([version, "invalid"]);
            expect(problemOf(state)).toBe('$: unknown member "intellisensePath"');
        }
    });

    test("a path that is not absolute, or is not text, is invalid", () => {
        for (const value of ['"intellisense"', '"~/.cargo/bin/intellisense"', '"/"', "7", "null"]) {
            const state = readSettingsState(
                documentBytes(`{"version":3,"intellisensePath":${value}}`),
            );

            expect([value, state.status]).toEqual([value, "invalid"]);
            expect(problemOf(state)).toStartWith("$.intellisensePath: ");
        }
    });

    test("a version 4 document is unsupported, as version 3 is to an older Pico", () => {
        const state = readSettingsState(documentBytes('{"version":4}'));

        expect(state.status).toBe("unsupported");
        expect(problemOf(state)).toContain("newer version of Pico");
    });

    test("a save writes version 3, with the path after the auto-background setting", () => {
        const text = serializeSettings({
            defaultModel: null,
            defaultThinking: null,
            autoBackground: false,
            intellisensePath: "/Users/pico/.cargo/bin/intellisense",
            providerCredentials: { anthropic: "ref-a" },
        });

        expect(text).toBe(
            [
                "{",
                '    "version": 3,',
                '    "autoBackground": false,',
                '    "intellisensePath": "/Users/pico/.cargo/bin/intellisense",',
                '    "providerCredentials": {',
                '        "anthropic": "ref-a"',
                "    }",
                "}",
                "",
            ].join("\n"),
        );
    });

    test("no saved path leaves the member out, and the document reads back the same", () => {
        const item = {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: null,
            intellisensePath: null,
            providerCredentials: {},
        };
        const bytes = documentBytes(serializeSettings(item));

        expect(new TextDecoder().decode(bytes)).toBe('{\n    "version": 3\n}\n');
        expect(readSettingsState(bytes)).toEqual({
            status: "valid",
            revision: revisionOf(bytes),
            item,
        });
    });
});
