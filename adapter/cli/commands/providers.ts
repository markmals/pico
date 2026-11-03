import type { ProviderInfo } from "../../credentials/providers.ts";
import type { CredentialMetadata } from "../../credentials/types.ts";
import type { CredentialVault } from "../../credentials/vault.ts";
import type { PicoSettings } from "../../settings/settings-document.ts";
import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import { describeProvider, listProviders } from "../../credentials/providers.ts";
import { revisionOf, serializeSettings } from "../../settings/settings-document.ts";
import {
    SettingsConflictError,
    settingsFilePath,
    writeSettings,
} from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { projectCredential, unknownProvider, withVault } from "./credentials.ts";
import { ioError, readSettingsFile, settingsUnusable } from "./settings-file.ts";

interface UpdateOptions {
    credential?: string;
    disconnect?: boolean;
    ifRevision?: string;
    allowKeychainUi?: boolean;
    dryRun?: boolean;
}

export function providersList(context: HandlerContext): CommandHandler {
    return async () =>
        withVault(context, {}, vault => {
            const bindings = settingsBindings(context.dataDir);
            return { items: listProviders().map(info => described(info, bindings, vault)) };
        });
}

export function providersGet(context: HandlerContext): CommandHandler {
    return async given => {
        const provider = given.arguments.provider as string;
        const info = describeProvider(provider);
        if (!info) throw unknownProvider(provider);
        return withVault(context, {}, vault => ({
            item: described(info, settingsBindings(context.dataDir), vault),
        }));
    };
}

/**
 * Saves or removes one provider's credential selection. The Keychain item behind a new
 * selection is read before the settings lock is taken, so a macOS permission dialog never
 * happens inside a write transaction; the index is then rechecked under that lock.
 */
export function providersUpdate(context: HandlerContext): CommandHandler {
    return async given => {
        const options = given.options as UpdateOptions;
        const provider = given.arguments.provider as string;
        if (!describeProvider(provider)) throw unknownProvider(provider);
        const settingsFile = settingsFilePath(context.dataDir);
        const state = readSettingsFile(context.dataDir);
        if ("problem" in state) {
            throw new CliError(
                "FAILED_PRECONDITION",
                `Pico's settings file ${settingsFile} cannot be updated: ${state.problem}. Fix or remove it first.`,
                { details: { settingsFile, problem: state.problem } },
            );
        }
        if (options.ifRevision !== undefined && options.ifRevision !== state.revision) {
            throw revisionConflict(settingsFile, options.ifRevision, state.revision);
        }
        const dryRun = options.dryRun === true;
        const current = state.item.providerCredentials[provider] ?? null;
        const chosen = options.disconnect === true ? null : (options.credential as string);
        const before = { revision: state.revision, credential: current };

        return withVault(
            context,
            { allowKeychainUI: options.allowKeychainUi === true },
            async vault => {
                const keychain =
                    chosen === null
                        ? ("not-checked" as const)
                        : checkSelection(vault, provider, chosen, dryRun);
                if (chosen === current) {
                    const actual = dryRun
                        ? state.revision
                        : readSettingsFile(context.dataDir).revision;
                    if (actual !== state.revision) {
                        throw revisionConflict(settingsFile, state.revision, actual);
                    }
                    return {
                        settingsFile,
                        provider,
                        dryRun,
                        changed: false,
                        keychain,
                        before,
                        after: before,
                    };
                }
                const after = withBinding(state.item, provider, chosen);
                if (dryRun) {
                    const revision = revisionOf(new TextEncoder().encode(serializeSettings(after)));
                    return {
                        settingsFile,
                        provider,
                        dryRun,
                        changed: true,
                        keychain,
                        before,
                        after: { revision, credential: chosen },
                    };
                }
                const saved = commit(context, vault, {
                    provider,
                    chosen,
                    item: after,
                    ifRevision: state.revision,
                });
                return {
                    settingsFile,
                    provider,
                    dryRun,
                    changed: true,
                    keychain,
                    before,
                    after: { revision: saved.revision, credential: chosen },
                };
            },
        );
    };
}

/**
 * Writes the binding under the shared credential lock, rechecking the credential's index row
 * inside it so a selection cannot race a deletion into a committed dangling reference. The
 * revision check happens in the same lock, not against the state read before it.
 */
function commit(
    context: HandlerContext,
    vault: CredentialVault,
    change: {
        provider: string;
        chosen: string | null;
        item: PicoSettings;
        ifRevision: string | undefined;
    },
): { revision: string } {
    try {
        return vault.locked(() => {
            if (change.chosen !== null) {
                selectable(vault.metadata(change.chosen), change.provider, change.chosen);
            }
            return writeSettings(context.dataDir, change.item, { ifRevision: change.ifRevision });
        });
    } catch (error) {
        if (error instanceof SettingsConflictError) {
            throw revisionConflict(error.path, error.expected, error.actual);
        }
        throw settingsUnusable(ioError(error));
    }
}

function revisionConflict(path: string, expected: string, actual: string): CliError {
    return new CliError(
        "CONFLICT",
        `${path} changed since revision ${expected}; read it again with \`pico settings get\` and retry.`,
        { details: { expected, actual } },
    );
}

/** Establishes that a reference names this provider's active credential, and that Pico can read it. */
function checkSelection(
    vault: CredentialVault,
    provider: string,
    reference: string,
    dryRun: boolean,
): "readable" | "not-checked" {
    const metadata = selectable(vault.metadata(reference), provider, reference);
    // A preview says what it checked: compatibility from the index, and no Keychain access.
    if (dryRun) return "not-checked";
    vault.verify(metadata.reference);
    return "readable";
}

function selectable(
    metadata: CredentialMetadata | undefined,
    provider: string,
    reference: string,
): CredentialMetadata {
    if (!metadata) {
        throw new CliError("NOT_FOUND", `Pico has no credential ${reference}.`, {
            details: { reference, accepted: "pico credentials list" },
        });
    }
    if (metadata.provider !== provider) {
        throw new CliError(
            "FAILED_PRECONDITION",
            `${reference} belongs to ${metadata.provider}, not ${provider}.`,
            { details: { reference, provider, credentialProvider: metadata.provider } },
        );
    }
    if (metadata.state !== "active") {
        throw new CliError("FAILED_PRECONDITION", `${reference} is being deleted.`, {
            details: { reference, state: metadata.state },
        });
    }
    return metadata;
}

function withBinding(item: PicoSettings, provider: string, chosen: string | null): PicoSettings {
    const providerCredentials = { ...item.providerCredentials };
    if (chosen === null) delete providerCredentials[provider];
    else providerCredentials[provider] = chosen;
    return { ...item, providerCredentials };
}

function described(info: ProviderInfo, bindings: Record<string, string>, vault: CredentialVault) {
    const selected = bindings[info.provider] ?? null;
    const metadata = selected === null ? undefined : vault.metadata(selected);
    return {
        provider: info.provider,
        name: info.name,
        apiKey: info.apiKey,
        apiKeyUnsupported: info.apiKeyUnsupported,
        selected,
        credential: metadata ? projectCredential(metadata) : null,
        methods: info.methods.map(method => ({ ...method })),
    };
}

function settingsBindings(dataDir: string): Record<string, string> {
    const state = readSettingsFile(dataDir);
    if ("problem" in state) {
        throw new CliError(
            "FAILED_PRECONDITION",
            `Pico's settings file ${settingsFilePath(dataDir)} cannot be used: ${state.problem}. Fix or remove it first.`,
            { details: { settingsFile: settingsFilePath(dataDir), problem: state.problem } },
        );
    }
    return state.item.providerCredentials;
}
