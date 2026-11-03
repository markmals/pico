import { describe, expect, test } from "bun:test";

import {
    acceptsApiKey,
    describeLoginMethod,
    describeProvider,
    listProviders,
} from "./providers.ts";

describe("proposal.0009 provider discovery from the installed engine", () => {
    test("every listed provider is named and carries only its own login methods", () => {
        const providers = listProviders();

        expect(providers.length).toBeGreaterThan(10);
        for (const provider of providers) {
            expect(provider.name.length).toBeGreaterThan(0);
            for (const method of provider.methods) {
                expect(method.provider).toBe(provider.provider);
            }
        }
    });

    test("a login alias keeps the provider its credentials are stored under", () => {
        const device = describeLoginMethod("openai-codex-device");

        expect(device?.provider).toBe("openai-codex");
        expect(describeProvider("openai-codex")?.methods.map(method => method.method)).toContain(
            "openai-codex-device",
        );
    });

    test("an unknown provider id is absent rather than invented", () => {
        expect(describeProvider("not-a-provider")).toBeUndefined();
        expect(describeLoginMethod("not-a-method")).toBeUndefined();
    });
});

describe("proposal.0009 which providers take a pasted API key", () => {
    test("a provider whose catalog definition declares a static key accepts one", () => {
        expect(acceptsApiKey("openai")).toEqual({ accepted: true });
        expect(acceptsApiKey("anthropic")).toEqual({ accepted: true });
        expect(describeProvider("openai")?.apiKey).toBe(true);
    });

    test("a cloud identity chain does not accept a pasted key, and says why", () => {
        for (const provider of ["amazon-bedrock", "google-vertex"]) {
            const verdict = acceptsApiKey(provider);

            expect(verdict.accepted).toBe(false);
            expect(verdict.accepted === false && verdict.reason.length).toBeGreaterThan(0);
            expect(describeProvider(provider)?.apiKey).toBe(false);
        }
    });

    test("a provider whose credential is structured rather than one key is refused", () => {
        const verdict = acceptsApiKey("github-copilot");

        expect(verdict.accepted).toBe(false);
        expect(verdict.accepted === false && verdict.reason).toContain("structured");
    });

    test("an unknown provider is refused without pretending to know it", () => {
        const verdict = acceptsApiKey("not-a-provider");

        expect(verdict.accepted).toBe(false);
        expect(verdict.accepted === false && verdict.reason).toContain("not a provider");
    });
});

describe("proposal.0009 Pico's login compatibility, reported apart from the engine's list", () => {
    test("a device-code method is supported and needs no browser on this machine", () => {
        const method = describeLoginMethod("openai-codex-device");

        expect(method?.supported).toBe(true);
        expect(method?.unsupported).toBeNull();
    });

    test("a loopback browser method is supported and says the browser must be here", () => {
        const method = describeLoginMethod("openai-codex");

        expect([method?.interaction, method?.localBrowser, method?.supported]).toEqual([
            "browser-callback",
            true,
            true,
        ]);
    });

    test("the engine's prompt-dependent Copilot login is unsupported before any flow starts", () => {
        const method = describeLoginMethod("github-copilot");

        expect(method?.supported).toBe(false);
        expect(method?.unsupported).toContain("Enterprise");
    });

    test("a paste-code-only method is unsupported, and says so", () => {
        for (const id of ["zai-coding-plan", "gitlab-duo-agent"]) {
            const method = describeLoginMethod(id);

            expect([id, method?.supported]).toEqual([id, false]);
            expect((method?.unsupported ?? "").length).toBeGreaterThan(0);
        }
    });

    test("a method that only takes a pasted key sends the agent to the private stdin command", () => {
        const method = describeLoginMethod("zai");

        expect([method?.interaction, method?.supported]).toEqual(["api-key", false]);
        expect(method?.unsupported).toContain("pico credentials create");
    });

    test("every unsupported method states a reason and every supported one states none", () => {
        for (const provider of listProviders()) {
            for (const method of provider.methods) {
                expect([method.method, method.supported, method.unsupported === null]).toEqual([
                    method.method,
                    method.supported,
                    method.supported,
                ]);
            }
        }
    });
});
