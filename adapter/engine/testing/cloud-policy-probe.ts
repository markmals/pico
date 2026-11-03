/**
 * Reports what Pico's credential policy would let a remote provider do, from a process whose
 * HOME and agent directory are scratch directories. It runs in its own process so the SDK is
 * imported only after those are set: a provider's ambient cloud chain resolves files relative to
 * the home it starts with, and this probe must never reach the human's. It performs no Keychain
 * operation and makes no network request.
 */

import { PROVIDER_REGISTRY } from "@oh-my-pi/pi-ai/registry";

import { createMemorySecretStore } from "../../credentials/testing/memory-secret-store.ts";
import { openPicoCredentials } from "../credential-policy.ts";

export interface CloudPolicyReport {
    /**
     * Providers whose transport authenticates itself and that are reached over a vendor's
     * network: they declare a credential source of their own (an environment resolver or a
     * login flow) as well as self-authenticating transport. The SDK's virtual keyless providers
     * declare neither, which is what separates them from a cloud identity chain.
     */
    remote: string[];
    /** Those of them the machine's own configuration could authorize right now. */
    ambient: string[];
    /** Those of them Pico answered a credential for, which is the substitution to refuse. */
    resolved: { provider: string; key: string }[];
    /** Those of them Pico still offers models for. */
    available: string[];
    /** What a genuinely keyless local provider resolves, which must keep working. */
    localDiscovery: { provider: string; resolved: string | undefined }[];
    /** The SDK's virtual providers, which back the web-search tool and locally hosted models. */
    virtual: { provider: string; resolved: string | undefined; ambient: boolean }[];
}

const dataDir = process.argv[2];
if (dataDir === undefined) throw new Error("usage: cloud-policy-probe <dataDir>");

const credentials = await openPicoCredentials({ dataDir, keychain: createMemorySecretStore() });
try {
    const { registry, authStorage } = credentials;
    const remote = PROVIDER_REGISTRY.filter(
        provider =>
            (provider.allowsMissingApiKey === true || (provider.nativeAuthApis?.length ?? 0) > 0) &&
            (provider.envKeys !== undefined || provider.login !== undefined),
    ).map(provider => provider.id);

    const resolved: CloudPolicyReport["resolved"] = [];
    for (const provider of remote) {
        const key = await registry.getApiKeyForProvider(provider);
        if (key !== undefined) resolved.push({ provider, key });
    }

    const offered = new Set(registry.getAvailable("all").map(model => model.provider));
    const report: CloudPolicyReport = {
        remote,
        // `source` follows the same precedence a request does, so a provider listed here has an
        // ambient route the policy must close rather than a hypothetical one.
        ambient: remote.filter(provider => authStorage.keys.source(provider) !== undefined),
        resolved,
        available: remote.filter(provider => offered.has(provider)),
        localDiscovery: await Promise.all(
            registry.getDiscoverableProviders().map(async provider => ({
                provider,
                resolved: await registry.getApiKeyForProvider(provider),
            })),
        ),
        virtual: await Promise.all(
            ["local", "web"].map(async provider => ({
                provider,
                resolved: await registry.getApiKeyForProvider(provider),
                ambient: authStorage.keys.source(provider) !== undefined,
            })),
        ),
    };
    process.stdout.write(JSON.stringify(report));
} finally {
    credentials.close();
}
