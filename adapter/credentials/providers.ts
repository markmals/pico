// Provider and login-method metadata, read from the engine's compiled auth and catalog
// definitions. Those are published JSON accessors, so this module loads no provider transport
// and no native addon: discovery and previews answer before Pico has extracted one, in the
// compiled executable as well as from source (proposal.0009). A method an extension registers
// at runtime is resolved by `login.ts`, which runs after the engine is loaded.

import type { CompiledAuthProvider } from "@oh-my-pi/pi-catalog/compat/types";

import { authPolicyFor, authProviders } from "@oh-my-pi/pi-catalog/compat/auth";
import { providerEntries } from "@oh-my-pi/pi-catalog/compat/providers";

/** How the human finishes one login method, as the engine's compiled policy declares it. */
export type Interaction = "browser-callback" | "device-code" | "api-key" | "engine-defined";

export interface LoginMethodInfo {
    /** The engine's login id, which `pico auth login` takes. */
    method: string;
    name: string;
    /** The model provider the finished login is stored under, which can differ from `method`. */
    provider: string;
    interaction: Interaction;
    /**
     * Whether finishing needs a browser on the machine running Pico: true for a loopback
     * callback, false for a device flow, and null when the engine implements the flow in code
     * and declares nothing about it.
     */
    localBrowser: boolean | null;
    supported: boolean;
    /** Why Pico refuses to run it, in one sentence; null when it is supported. */
    unsupported: string | null;
}

export interface ProviderInfo {
    provider: string;
    name: string;
    /** Whether `pico credentials create` can store a pasted key for it. */
    apiKey: boolean;
    /** Why a pasted key is refused; null when one is accepted. */
    apiKeyUnsupported: string | null;
    methods: readonly LoginMethodInfo[];
}

export type ApiKeyVerdict = { accepted: true } | { accepted: false; reason: string };

/**
 * Login methods the installed engine implements in code rather than in its declarative
 * grammar, and which Pico has read and found to always ask the human a question. `auth login`
 * collects no answers, so these are refused before a flow starts rather than part-way through.
 * A flow absent from this table starts, and an unexpected question aborts it.
 */
const VERIFIED_PROMPTING_METHODS: Record<string, string | undefined> = {
    "github-copilot":
        "The engine's GitHub Copilot login always asks for an Enterprise domain, and pico auth login answers no questions.",
};

/** Every provider Pico can describe: the catalog's model providers plus every login destination. */
export function listProviders(): ProviderInfo[] {
    const providers = new Set<string>(Object.keys(providerEntries()));
    for (const method of methods()) providers.add(method.provider);
    return [...providers]
        .map(provider => describeProvider(provider))
        .filter((provider): provider is ProviderInfo => provider !== undefined)
        .sort((left, right) => left.provider.localeCompare(right.provider));
}

export function describeProvider(provider: string): ProviderInfo | undefined {
    const policy = authPolicyFor(provider);
    const entry = providerEntries()[provider];
    const own = methods().filter(method => method.provider === provider);
    if (!policy && !entry && own.length === 0) return undefined;
    const verdict = acceptsApiKey(provider);
    return {
        provider,
        name: policy?.name ?? provider,
        apiKey: verdict.accepted,
        apiKeyUnsupported: verdict.accepted ? null : verdict.reason,
        methods: own,
    };
}

export function describeLoginMethod(method: string): LoginMethodInfo | undefined {
    return methods().find(declared => declared.method === method);
}

/**
 * Whether a provider takes one pasted key, decided from its compiled auth policy and catalog
 * entry rather than from a familiar name. A structured credential, a transport that resolves
 * its own identity, and a provider whose only key-shaped environment value is an OAuth bearer
 * all take configuration a pasted key cannot supply.
 */
export function acceptsApiKey(provider: string): ApiKeyVerdict {
    const policy = authPolicyFor(provider);
    if (!policy)
        return { accepted: false, reason: `${provider} is not a provider this Pico knows.` };
    if (policy.apiKeyFormat !== "bearer") {
        return {
            accepted: false,
            reason: `${policy.name} uses a structured credential rather than one key; connect it with pico auth login.`,
        };
    }
    if (policy.nativeAuthApis?.length) {
        return {
            accepted: false,
            reason: `${policy.name} authenticates through its own cloud credential chain, which a pasted key cannot replace.`,
        };
    }
    if (policy.allowsMissingApiKey) {
        return {
            accepted: false,
            reason: `${policy.name} needs no stored credential.`,
        };
    }
    if (policy.login?.kind === "api-key") return { accepted: true };
    if (staticKeyVariables(policy).length === 0) {
        return {
            accepted: false,
            reason: `${policy.name} declares no static API key; it is configured another way.`,
        };
    }
    return { accepted: true };
}

/** The provider's key-shaped environment variables, excluding ones carrying an OAuth bearer. */
function staticKeyVariables(policy: CompiledAuthProvider): readonly string[] {
    const oauth = new Set(policy.oauthTokenEnv ?? []);
    const declared = providerEntries()[policy.id]?.envVars ?? [];
    return declared.filter(name => !oauth.has(name));
}

/** Every login the compiled policies declare, in the engine's own display order. */
function methods(): readonly LoginMethodInfo[] {
    return authProviders()
        .filter(policy => policy.login !== undefined && policy.showInLoginList !== false)
        .map(policy => describedMethod(policy.id, policy.name, policy));
}

/**
 * One login method, classified. `policy` is absent for a method the engine registered at
 * runtime: it is a real flow whose interaction is undeclared, so it starts and an unexpected
 * question aborts it.
 */
export function describedMethod(
    method: string,
    name: string,
    policy: CompiledAuthProvider | undefined,
    storeCredentialsAs?: string,
): LoginMethodInfo {
    const unsupported = refusal(method, policy?.available !== false, policy);
    return {
        method,
        name,
        provider: storeCredentialsAs ?? policy?.storeAs ?? method,
        interaction: interactionOf(policy),
        localBrowser: localBrowserOf(policy),
        supported: unsupported === null,
        unsupported,
    };
}

function interactionOf(policy: CompiledAuthProvider | undefined): Interaction {
    switch (policy?.login?.kind) {
        case "oauth-code":
            return "browser-callback";
        case "device-code":
            return "device-code";
        case "api-key":
            return "api-key";
        default:
            return "engine-defined";
    }
}

function localBrowserOf(policy: CompiledAuthProvider | undefined): boolean | null {
    switch (policy?.login?.kind) {
        case "oauth-code":
            return true;
        case "device-code":
        case "api-key":
            return false;
        default:
            return null;
    }
}

/**
 * Why `pico auth login` refuses a method, or null when it runs it. Pico supports the flows that
 * finish through an authorization URL: it answers no question, pastes no code back, and drives
 * no browser session.
 */
function refusal(
    method: string,
    available: boolean,
    policy: CompiledAuthProvider | undefined,
): string | null {
    if (!available) return `${policy?.name ?? method} is not available in this Pico's engine.`;
    // A method the engine registered at runtime declares no interaction; it starts, and an
    // unexpected question aborts it rather than being answered.
    if (!policy?.login) return VERIFIED_PROMPTING_METHODS[method] ?? null;
    if (policy.login.kind === "api-key") {
        return `${policy.name} takes a key you already hold; store it with pico credentials create --provider ${policy.storeAs ?? policy.id} --stdin.`;
    }
    if (policy.login.kind === "oauth-code" && policy.login.callback.manualOnly) {
        return `${policy.name} finishes only by pasting the authorization code back, which pico auth login never collects.`;
    }
    if (policy.login.kind === "custom" && policy.pasteCode === true) {
        return `${policy.name} finishes by pasting an authorization code back, which pico auth login never collects.`;
    }
    return VERIFIED_PROMPTING_METHODS[method] ?? null;
}
