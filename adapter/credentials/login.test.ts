import type { OAuthController, OAuthCredentials } from "@oh-my-pi/pi-ai/oauth";

import { registerOAuthProvider, unregisterOAuthProvider } from "@oh-my-pi/pi-ai/registry";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoginEvent } from "./login.ts";

import { LoginError, runLogin } from "./login.ts";
import { createMemorySecretStore } from "./testing/memory-secret-store.ts";
import { openCredentialVault } from "./vault.ts";

const METHOD = "pico-test-login";
const FAKE_GRANT: OAuthCredentials = {
    access: "FAKE-pico-0009-access",
    refresh: "FAKE-pico-0009-refresh",
    expires: Date.now() + 3_600_000,
    email: "someone@example.test",
    accountId: "account-0009",
};

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A login method implemented for this test only; it is registered and removed per test. */
function fakeProvider(
    login: (callbacks: OAuthController) => Promise<OAuthCredentials | string>,
    options: { storeCredentialsAs?: string } = {},
): void {
    registerOAuthProvider({ id: METHOD, name: "Pico test login", login, ...options });
    cleanups.push(() => unregisterOAuthProvider(METHOD));
}

function vault() {
    const dataDir = mkdtempSync(join(tmpdir(), "pico-login-"));
    const keychain = createMemorySecretStore();
    const opened = openCredentialVault({ dataDir, keychain });
    cleanups.push(() => {
        opened.close();
        rmSync(dataDir, { recursive: true, force: true });
    });
    return { vault: opened, keychain, dataDir };
}

function recorder() {
    const events: LoginEvent[] = [];
    return { events, emit: (event: LoginEvent) => void events.push(event) };
}

function typesOf(events: readonly LoginEvent[]): string[] {
    return events.map(event => event.type);
}

describe("proposal.0009 an agent-driven login", () => {
    test("the engine's authorization URL and instructions reach the agent untouched", async () => {
        const url = "https://example.test/authorize?code_challenge=FAKE&state=0009";
        fakeProvider(async callbacks => {
            callbacks.onAuth?.({
                url,
                launchUrl: "http://localhost:1455/launch",
                instructions: "Enter code PICO-0009 when asked.",
            });
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        await runLogin({ method: METHOD, vault: opened, emit });

        const authorization = events.find(event => event.type === "authorization");
        expect(authorization).toMatchObject({
            url,
            launchUrl: "http://localhost:1455/launch",
            instructions: "Enter code PICO-0009 when asked.",
            localBrowser: true,
        });
    });

    test("a device flow without a loopback URL says no browser is needed here", async () => {
        fakeProvider(async callbacks => {
            callbacks.onAuth?.({ url: "https://example.test/device", instructions: "Code: 0009" });
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        await runLogin({ method: METHOD, vault: opened, emit });

        expect(events.find(event => event.type === "authorization")).toMatchObject({
            launchUrl: null,
            localBrowser: false,
        });
    });

    test("the stream starts, reports progress and ends in one completed event", async () => {
        fakeProvider(async callbacks => {
            callbacks.onAuth?.({ url: "https://example.test/authorize" });
            callbacks.onProgress?.("waiting for the browser");
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect(typesOf(events)).toEqual(["started", "authorization", "progress", "completed"]);
        expect(events.map(event => event.sequence)).toEqual([0, 1, 2, 3]);
        expect(new Set(events.map(event => event.attemptId)).size).toBe(1);
        const completed = events.at(-1);
        expect(completed).toMatchObject({ type: "completed", stored: true });
        expect(completed).toMatchObject({
            credential: { reference: stored.reference, kind: "oauth", state: "active" },
        });
    });

    test("the engine's progress text never reaches the stream", async () => {
        const marker = "FAKE-pico-0009-progress-bearer-material";
        fakeProvider(async callbacks => {
            callbacks.onAuth?.({ url: "https://example.test/authorize" });
            callbacks.onProgress?.(`exchanging the code for ${marker}`);
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        await runLogin({ method: METHOD, vault: opened, emit });

        // The agent learns the attempt is alive; what the engine printed is not forwarded.
        expect(typesOf(events)).toContain("progress");
        expect(JSON.stringify(events)).not.toContain(marker);
    });

    test("the grant is durable before completion is reported, and its secret is nowhere in the stream", async () => {
        fakeProvider(async () => FAKE_GRANT);
        const { vault: opened, keychain } = vault();
        const { events, emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect(opened.metadata(stored.reference)?.state).toBe("active");
        expect(keychain.items.has(stored.reference)).toBe(true);
        const stream = JSON.stringify(events);
        expect(stream).not.toContain(FAKE_GRANT.access);
        expect(stream).not.toContain(FAKE_GRANT.refresh);
    });

    test("the provider's own account metadata reaches the receipt", async () => {
        fakeProvider(async () => FAKE_GRANT);
        const { vault: opened } = vault();
        const { emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect([stored.email, stored.accountId]).toEqual(["someone@example.test", "account-0009"]);
    });

    test("a nonrefreshing device grant remains usable after storage", async () => {
        fakeProvider(async () => ({ ...FAKE_GRANT, refresh: "" }));
        const { vault: opened } = vault();
        const { emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect(opened.read(stored.reference).credential).toMatchObject({
            type: "oauth",
            access: FAKE_GRANT.access,
            refresh: "",
            expires: FAKE_GRANT.expires,
        });
    });

    test("a login alias stores its result under the provider it names", async () => {
        fakeProvider(async () => FAKE_GRANT, { storeCredentialsAs: "pico-test-destination" });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect(stored.provider).toBe("pico-test-destination");
        expect(events[0]).toMatchObject({ type: "started", provider: "pico-test-destination" });
    });

    test("an API key already stored for the provider survives the login", async () => {
        fakeProvider(async () => FAKE_GRANT, { storeCredentialsAs: "pico-test-destination" });
        const { vault: opened } = vault();
        const existing = await opened.create("pico-test-destination", {
            type: "api_key",
            key: "FAKE-pico-0009-existing",
        });
        const { emit } = recorder();

        const stored = await runLogin({ method: METHOD, vault: opened, emit });

        expect(opened.metadata(existing.reference)?.state).toBe("active");
        expect(
            opened
                .list("pico-test-destination")
                .map(item => item.reference)
                .sort(),
        ).toEqual([existing.reference, stored.reference].sort());
    });
});

describe("proposal.0009 login refuses every question", () => {
    test("a flow that asks a question fails without storing anything", async () => {
        let asked = false;
        fakeProvider(async callbacks => {
            asked = true;
            await callbacks.onPrompt?.({ message: "Enterprise domain?" });
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect(asked).toBe(true);
        expect(error).toBeInstanceOf(LoginError);
        expect((error as LoginError).code).toBe("FAILED_PRECONDITION");
        expect(opened.list()).toEqual([]);
    });

    test("a flow that wants a browser session fails the same way", async () => {
        fakeProvider(async callbacks => {
            await callbacks.onBrowserSession?.({
                url: "https://example.test/session",
                cookieNames: ["session"],
            });
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("FAILED_PRECONDITION");
        expect(opened.list()).toEqual([]);
    });

    test("an unexpected pasted-code request fails rather than waiting for the deadline", async () => {
        fakeProvider(async callbacks => {
            await callbacks.onManualCodeInput?.(callbacks.signal);
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        const error = await runLogin({
            method: METHOD,
            vault: opened,
            emit,
            deadlineMs: 50,
        }).catch(failure => failure as LoginError);

        expect((error as LoginError).code).toBe("FAILED_PRECONDITION");
        expect(typesOf(events)).toEqual(["started"]);
        expect(opened.list()).toEqual([]);
    });

    test("a flow cannot swallow an unsupported question and publish a grant", async () => {
        fakeProvider(async callbacks => {
            await callbacks.onPrompt?.({ message: "Enter a private answer" }).catch(() => {});
            return FAKE_GRANT;
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("FAILED_PRECONDITION");
        expect(opened.list()).toEqual([]);
    });

    test("an API-key flow result is refused rather than stored as a login", async () => {
        fakeProvider(async () => "FAKE-pico-0009-pasted-key");
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("FAILED_PRECONDITION");
        expect((error as LoginError).message).toContain("pico credentials create");
        expect(opened.list()).toEqual([]);
    });
});

describe("proposal.0009 login ends on its own terms", () => {
    test("a cancelled attempt publishes no credential", async () => {
        const controller = new AbortController();
        // The flow never settles: ending the attempt is the caller's job, not the provider's.
        fakeProvider(async () => {
            controller.abort();
            return Promise.withResolvers<OAuthCredentials>().promise;
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({
            method: METHOD,
            vault: opened,
            emit,
            signal: controller.signal,
        }).catch(failure => failure as LoginError);

        expect((error as LoginError).code).toBe("CANCELLED");
        expect(opened.list()).toEqual([]);
    });

    test("an attempt past its deadline fails as timed out", async () => {
        // The deadline is real elapsed time by design; 20 ms keeps the genuine timer cheap.
        fakeProvider(async () => Promise.withResolvers<OAuthCredentials>().promise);
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        const error = await runLogin({
            method: METHOD,
            vault: opened,
            emit,
            deadlineMs: 20,
        }).catch(failure => failure as LoginError);

        expect((error as LoginError).code).toBe("TIMED_OUT");
        expect((error as LoginError).retryable).toBe(true);
        expect(typesOf(events)).toEqual(["started"]);
    });

    test("the authorization deadline does not cancel a subsequent Keychain commit", async () => {
        const deadline = new AbortController();
        const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
        try {
            fakeProvider(async () => FAKE_GRANT);
            const { vault: opened, keychain } = vault();
            const write = keychain.set.bind(keychain);
            keychain.set = (reference, payload) => {
                write(reference, payload);
                deadline.abort();
            };
            const { emit } = recorder();

            const stored = await runLogin({ method: METHOD, vault: opened, emit });

            expect(opened.read(stored.reference).credential).toMatchObject({
                access: FAKE_GRANT.access,
                refresh: FAKE_GRANT.refresh,
            });
            expect(opened.metadata(stored.reference)?.state).toBe("active");
        } finally {
            timeout.mockRestore();
        }
    });

    test("a denial from the provider is reported as an authorization failure", async () => {
        const { OAuthError } = await import("@oh-my-pi/pi-ai/error");
        fakeProvider(async () => {
            throw new OAuthError("the user denied the request", {
                kind: "device-auth",
                provider: METHOD,
            });
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("AUTH_REQUIRED");
        expect((error as LoginError).details).toMatchObject({ kind: "device-auth" });
        expect(opened.list()).toEqual([]);
    });

    test("a provider failure carries its safe category, not its response", async () => {
        const { OAuthError } = await import("@oh-my-pi/pi-ai/error");
        fakeProvider(async () => {
            throw new OAuthError("token endpoint said no", { kind: "token-exchange", status: 500 });
        });
        const { vault: opened } = vault();
        const { emit } = recorder();

        const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("UNAVAILABLE");
        expect((error as LoginError).details).toEqual({
            method: METHOD,
            provider: METHOD,
            kind: "token-exchange",
            status: 500,
        });
    });

    for (const classified of [false, true]) {
        test(`a ${classified ? "classified" : "generic"} provider error cannot expose response material`, async () => {
            const marker = "FAKE-pico-0009-private-error-material";
            const { OAuthError } = await import("@oh-my-pi/pi-ai/error");
            fakeProvider(async () => {
                throw classified
                    ? new OAuthError(`Token response: ${marker}`, {
                          kind: "token-exchange",
                          status: 503,
                      })
                    : new Error(`Callback URL: https://example.test/?code=${marker}`);
            });
            const { vault: opened } = vault();
            const { emit } = recorder();

            const error = await runLogin({ method: METHOD, vault: opened, emit }).catch(
                failure => failure as LoginError,
            );

            expect((error as LoginError).code).toBe("UNAVAILABLE");
            expect(
                JSON.stringify({
                    message: (error as LoginError).message,
                    details: (error as LoginError).details,
                }),
            ).not.toContain(marker);
            expect(opened.list()).toEqual([]);
        });
    }

    test("a method this engine does not implement never starts a flow", async () => {
        const { vault: opened } = vault();
        const { events, emit } = recorder();

        const error = await runLogin({ method: "pico-absent-login", vault: opened, emit }).catch(
            failure => failure as LoginError,
        );

        expect((error as LoginError).code).toBe("NOT_FOUND");
        expect(events).toEqual([]);
    });
});
