import { describe, expect, test } from "bun:test";

import {
    modelsGetOutput,
    modelsListOutput,
    settingsGetOutput,
    settingsUpdateOutput,
} from "./result-schemas.ts";

const MODEL = {
    value: "anthropic/claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    provider: "anthropic",
    thinking: [
        { value: "off", name: "Off" },
        { value: "auto", name: "Auto" },
        { value: "high", name: "high" },
    ],
    defaultThinking: "high",
};

const SETTINGS_FILE = "/Users/mark/Library/Application Support/Pico/settings.json";
const REVISION = `sha256:${"3".repeat(64)}`;

describe("proposal.0007 declared result shapes", () => {
    test("a catalog listing carries the provider bindings it used and every model", () => {
        expect(
            modelsListOutput.safeParse({
                apiVersion: 1,
                providerCredentials: { anthropic: "0f8e2c1a-4b6d-4e2f-9a1b-7c3d5e8f0a2b" },
                items: [MODEL],
            }).success,
        ).toBe(true);
        expect(
            modelsGetOutput.safeParse({
                apiVersion: 1,
                providerCredentials: {},
                item: MODEL,
            }).success,
        ).toBe(true);
    });

    test("a model without its thinking choices is not a model", () => {
        const { thinking, ...incomplete } = MODEL;

        expect(thinking.length).toBe(3);
        expect(
            modelsGetOutput.safeParse({
                apiVersion: 1,
                providerCredentials: {},
                item: incomplete,
            }).success,
        ).toBe(false);
    });

    test("settings that are saved carry the item and what a session would start on", () => {
        expect(
            settingsGetOutput.safeParse({
                apiVersion: 1,
                settingsFile: SETTINGS_FILE,
                status: "valid",
                revision: REVISION,
                item: {
                    defaultModel: "anthropic/claude-sonnet-5-5",
                    defaultThinking: "high",
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
                effective: {
                    defaultModel: "anthropic/claude-sonnet-5-5",
                    defaultThinking: "high",
                    source: "settings",
                    available: true,
                    autoBackground: true,
                },
            }).success,
        ).toBe(true);
    });

    test("a missing settings file has no revision and two null values", () => {
        expect(
            settingsGetOutput.safeParse({
                apiVersion: 1,
                settingsFile: SETTINGS_FILE,
                status: "missing",
                revision: "none",
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
                effective: {
                    defaultModel: "anthropic/claude-sonnet-5-5",
                    defaultThinking: "high",
                    source: "built-in",
                    available: true,
                    autoBackground: true,
                },
            }).success,
        ).toBe(true);
        expect(
            settingsGetOutput.safeParse({
                apiVersion: 1,
                settingsFile: SETTINGS_FILE,
                status: "missing",
                revision: REVISION,
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
                effective: {
                    defaultModel: null,
                    defaultThinking: null,
                    source: "built-in",
                    available: false,
                    autoBackground: true,
                },
            }).success,
        ).toBe(false);
    });

    test("an unreadable settings file carries its problem and no values", () => {
        const invalid = {
            apiVersion: 1,
            settingsFile: SETTINGS_FILE,
            status: "invalid",
            revision: REVISION,
            item: null,
            effective: null,
            problem: "version: expected the integer 1",
        };

        expect(settingsGetOutput.safeParse(invalid).success).toBe(true);
        expect(settingsGetOutput.safeParse({ ...invalid, problem: undefined }).success).toBe(false);
        expect(
            settingsGetOutput.safeParse({
                ...invalid,
                item: { defaultModel: null, defaultThinking: null, autoBackground: null },
            }).success,
        ).toBe(false);
    });

    test("a receipt carries the revision and item before and after", () => {
        const receipt = {
            apiVersion: 1,
            settingsFile: SETTINGS_FILE,
            dryRun: false,
            changed: true,
            before: {
                revision: "none",
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
            },
            after: {
                revision: REVISION,
                item: {
                    defaultModel: "anthropic/claude-sonnet-5-5",
                    defaultThinking: "high",
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
            },
        };

        expect(settingsUpdateOutput.safeParse(receipt).success).toBe(true);
        expect(
            settingsUpdateOutput.safeParse({
                ...receipt,
                after: { ...receipt.after, revision: "sha256:beef" },
            }).success,
        ).toBe(false);
    });
});

describe("proposal.0008 autoBackground in the declared result shapes", () => {
    const SAVED = {
        apiVersion: 1,
        settingsFile: SETTINGS_FILE,
        status: "valid",
        revision: REVISION,
        item: {
            defaultModel: null,
            defaultThinking: null,
            autoBackground: false,
            intellisensePath: null,
            providerCredentials: {},
        },
        effective: {
            defaultModel: "anthropic/claude-sonnet-5-5",
            defaultThinking: "high",
            source: "built-in",
            available: true,
            autoBackground: false,
        },
    };

    test("settings get carries the saved value and the value a session would use", () => {
        expect(settingsGetOutput.safeParse(SAVED).success).toBe(true);
        expect(
            settingsGetOutput.safeParse({
                ...SAVED,
                item: { ...SAVED.item, autoBackground: null },
            }).success,
        ).toBe(true);
    });

    test("both members are required, and only the saved one may be null", () => {
        expect(
            settingsGetOutput.safeParse({
                ...SAVED,
                item: { defaultModel: null, defaultThinking: null },
            }).success,
        ).toBe(false);
        expect(
            settingsGetOutput.safeParse({
                ...SAVED,
                effective: { ...SAVED.effective, autoBackground: undefined },
            }).success,
        ).toBe(false);
        expect(
            settingsGetOutput.safeParse({
                ...SAVED,
                effective: { ...SAVED.effective, autoBackground: null },
            }).success,
        ).toBe(false);
    });

    test("a receipt carries the saved value before and after", () => {
        const receipt = {
            apiVersion: 1,
            settingsFile: SETTINGS_FILE,
            dryRun: false,
            changed: true,
            before: {
                revision: "none",
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: null,
                    intellisensePath: null,
                    providerCredentials: {},
                },
            },
            after: {
                revision: REVISION,
                item: {
                    defaultModel: null,
                    defaultThinking: null,
                    autoBackground: false,
                    intellisensePath: null,
                    providerCredentials: {},
                },
            },
        };

        expect(settingsUpdateOutput.safeParse(receipt).success).toBe(true);
        expect(
            settingsUpdateOutput.safeParse({
                ...receipt,
                after: { ...receipt.after, item: { defaultModel: null, defaultThinking: null } },
            }).success,
        ).toBe(false);
    });
});
