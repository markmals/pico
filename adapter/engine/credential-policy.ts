import type { Api, AuthStorage, Model } from "@oh-my-pi/pi-ai";
import type { ResolvedApiKey } from "@oh-my-pi/pi-ai/auth-retry";
import type { AuthApiKeyOptions } from "@oh-my-pi/pi-ai/auth-storage";
import type { Settings } from "@oh-my-pi/pi-coding-agent";

import { PROVIDER_REGISTRY } from "@oh-my-pi/pi-ai/registry";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import { cfgDisabledProviders } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import path from "node:path";

import type { SecretStore } from "../credentials/keychain.ts";

import { CredentialError } from "../credentials/errors.ts";
import { openCredentialVault } from "../credentials/vault.ts";
import { DEFAULT_AUTO_BACKGROUND } from "../settings/settings-document.ts";
import { readProviderBindings } from "../settings/settings-store.ts";
import { OMP_CONFIGURATION_PROVIDERS, picoSettings } from "./pico-settings.ts";

/** Pico's credential policy over one data directory: its vault, its storage and its registry. */
export interface PicoCredentials {
    /** The Keychain-backed storage every Pico request resolves through. */
    readonly authStorage: AuthStorage;
    /** The registry built over that storage; `createAgentSession` requires this exact pair. */
    readonly registry: ModelRegistry;
    /** The bindings as the settings file holds them now. Throws when it cannot be used. */
    providerCredentials(): Record<string, string>;
    close(): void;
}

export interface PicoCredentialsOptions {
    dataDir: string;
    /** An in-process Keychain for tests; production always uses the native bridge. */
    keychain?: SecretStore;
}

/**
 * Reads the credential a provider is bound to, as the vault holds it right now: it fails when
 * the Keychain item is missing, locked, denied or malformed, and names the SDK row the request
 * must be answered with.
 */
export interface SelectedCredentialReader {
    (reference: string): { rowId: number };
}

/** A provider request that something other than the selected credential tried to answer. */
function substituted(provider: string, reference: string, instead: string): CredentialError {
    return new CredentialError(
        "UNAVAILABLE",
        `Pico's selected credential for ${provider} did not serve this request, and Pico does not use ${instead} in its place. Check it with \`pico credentials get ${reference}\`.`,
        { details: { provider, reference } },
    );
}

/**
 * Opens Pico's own credentials for `dataDir`. Nothing here reads the user's Oh My Pi store:
 * a provider is authorized by an explicit Pico binding or not at all (proposal.0009).
 */
export async function openPicoCredentials(
    options: PicoCredentialsOptions,
): Promise<PicoCredentials> {
    const { dataDir } = options;
    const vault = openCredentialVault({ dataDir, keychain: options.keychain });
    let authStorage: AuthStorage | undefined;
    try {
        authStorage = await vault.authStorage(() => selectedReferences(dataDir));
        // Every request rereads the selected item itself, so a Keychain item removed, locked
        // or replaced since the last one changes this one's outcome (proposal.0009).
        const opened = authStorage;
        const registry = new PicoModelRegistry(authStorage, dataDir, reference =>
            vault.read(reference),
        );
        return {
            authStorage,
            registry,
            providerCredentials: () => readProviderBindings(dataDir),
            close: () => {
                opened.close();
                vault.close();
            },
        };
    } catch (error) {
        // A registry that cannot read the settings it binds credentials from leaves nothing
        // open behind it: the caller never received a handle it could close.
        authStorage?.close();
        vault.close();
        throw error;
    }
}

/**
 * The references the store may expose right now. A settings file Pico cannot use exposes
 * nothing rather than a last-known selection; the request itself then fails with the
 * settings problem, which {@link PicoModelRegistry} reports before reaching the store.
 */
function selectedReferences(dataDir: string): readonly string[] {
    try {
        return Object.values(readProviderBindings(dataDir));
    } catch {
        return [];
    }
}

/**
 * The SDK's own virtual model providers. They are not vendor endpoints reached with a
 * credential: `local` serves models the runtime hosts itself and `web` backs the web-search
 * tool, so both answer with the no-auth sentinel and neither is something a Pico binding could
 * select. The registry does not list them as discoverable, so they are named here.
 */
const VIRTUAL_KEYLESS = ["local", "web"];

/**
 * A registry that answers a provider request only with the credential Pico's settings bind to
 * that provider.
 *
 * Two things enforce that, because the SDK's cascade has more sources than one hook can cover.
 * Unbound providers are disabled, which `ModelRegistry` honors before it consults any
 * credential at all — so an environment variable, an ambient cloud identity chain, a broker
 * variable or an unselected stored grant cannot authorize a provider the user never connected,
 * and discovery never probes one either. A bound provider's resolution is then checked against
 * the stored row it came from: the cascade reports the row it selected, and reports none for an
 * environment or configuration key, so a selected credential that cannot serve fails here
 * instead of falling through to another account (proposal.0009).
 *
 * The bindings are reread on every resolution, so a selection saved in another process reaches
 * the next request — including a later request in the same turn, a compaction request and a
 * reopened session — without restarting Pico or rebuilding the session's registry.
 */
export class PicoModelRegistry extends ModelRegistry {
    readonly #dataDir: string;
    readonly #settings: Settings;
    /** Providers the SDK can authorize from somewhere other than Pico's vault. */
    readonly #managed: readonly string[];
    /** Providers that genuinely need no credential: local discovery stays keyless. */
    readonly #keyless: ReadonlySet<string>;
    /** The disabled list already written, so an unchanged policy writes no setting. */
    #applied: string | undefined;
    /**
     * Reads the selected credential's current Keychain item, failing when it is gone, locked,
     * denied or malformed. Supplied by {@link openPicoCredentials}; a registry built over a
     * caller's own storage has no vault to reread.
     */
    readonly #readSelected: SelectedCredentialReader | undefined;

    constructor(
        authStorage: AuthStorage,
        dataDir: string,
        readSelected?: SelectedCredentialReader,
    ) {
        // A registry resolves credentials and catalogs; the session owns the saved
        // auto-background choice, so this instance only needs a value its policy accepts.
        const settings = picoSettings(DEFAULT_AUTO_BACKGROUND);
        super(authStorage, undefined, {
            settings,
            ignoreLocalModelConfig: true,
            cacheDbPath: path.join(dataDir, "models.db"),
        });
        // The SDK registry installs its config-value resolver, which expands environment
        // names and shell commands. Pico's private-stdin keys are literal secret bytes.
        authStorage.keys.setResolver(async credential => credential);
        this.#dataDir = dataDir;
        this.#settings = settings;
        this.#readSelected = readSelected;
        this.#managed = PROVIDER_REGISTRY.map(provider => provider.id);
        // Read before anything is disabled: these are the providers the SDK itself serves
        // without a credential. A provider's own `allowsMissingApiKey` is not that claim — it
        // says the transport can authenticate without a resolved key string, which is exactly
        // what a cloud identity chain does, so exempting on it would let an ambient AWS or
        // Google credential authorize a provider nobody connected (proposal.0009).
        this.#keyless = new Set([...this.getDiscoverableProviders(), ...VIRTUAL_KEYLESS]);
        this.#apply(this.#bindings());
    }

    override async getApiKey(
        model: Model<Api>,
        sessionId?: string,
        options?: { signal?: AbortSignal },
    ): Promise<string | undefined> {
        const resolved = await this.getApiKeyWithCredentialForProvider(model.provider, sessionId, {
            baseUrl: model.baseUrl,
            modelId: model.id,
            signal: options?.signal,
        });
        return resolved?.apiKey;
    }

    override async getApiKeyWithCredentialForProvider(
        provider: string,
        sessionId?: string,
        options?: AuthApiKeyOptions,
    ): Promise<ResolvedApiKey | undefined> {
        const bindings = this.#bindings();
        this.#apply(bindings);
        const reference = bindings[provider];
        if (reference === undefined) {
            return super.getApiKeyWithCredentialForProvider(provider, sessionId, options);
        }
        // Reread the selected item before resolving: a removed, locked, denied or malformed
        // Keychain item fails this request rather than serving a cached payload, and the row
        // it names is the only one this request may be answered with (proposal.0009).
        const selected = this.#readSelected?.(reference);
        const resolved = await super.getApiKeyWithCredentialForProvider(
            provider,
            sessionId,
            options,
        );
        if (resolved === undefined) return undefined;
        // The cascade names the stored row it chose, and names none for a key it read from
        // the environment or a configuration file: that is the substitution to refuse.
        if (resolved.credentialId !== (selected?.rowId ?? resolved.credentialId)) {
            throw substituted(provider, reference, "another stored credential");
        }
        if (resolved.credentialId === undefined) {
            throw substituted(provider, reference, "an environment or configuration key");
        }
        return resolved;
    }

    #bindings(): Record<string, string> {
        return readProviderBindings(this.#dataDir);
    }

    /**
     * Disables every provider the SDK could otherwise authorize by itself and Pico has not
     * bound, leaving keyless local discovery and the bound providers enabled. Writing the
     * setting notifies the session, so a binding saved while a session is open applies to it.
     */
    #apply(bindings: Record<string, string>): void {
        const disabled = [
            ...OMP_CONFIGURATION_PROVIDERS,
            ...this.#managed.filter(
                provider => bindings[provider] === undefined && !this.#keyless.has(provider),
            ),
        ];
        const applied = disabled.join("\u0000");
        if (applied === this.#applied) return;
        this.#applied = applied;
        this.#settings.writeValue(cfgDisabledProviders, disabled, "override");
    }
}
