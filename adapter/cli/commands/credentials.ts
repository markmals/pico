import type { CredentialMetadata } from "../../credentials/types.ts";
import type { CredentialVault } from "../../credentials/vault.ts";
import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import { CredentialError } from "../../credentials/errors.ts";
import { acceptsApiKey, describeProvider } from "../../credentials/providers.ts";
import { CliError } from "../errors.ts";
import { readBindings } from "./settings-file.ts";

interface CredentialOptions {
    provider?: string;
    ifRevision?: string;
    allowKeychainUi?: boolean;
    dryRun?: boolean;
}

/** One credential as a receipt reports it: identity and account facts, never its payload. */
export function projectCredential(metadata: CredentialMetadata) {
    return {
        reference: metadata.reference,
        provider: metadata.provider,
        kind: metadata.kind,
        state: metadata.state,
        email: metadata.email ?? null,
        accountId: metadata.accountId ?? null,
        orgId: metadata.orgId ?? null,
        orgName: metadata.orgName ?? null,
    };
}

/** The command that selects a stored credential, which storing one deliberately does not do. */
export function selectCommand(provider: string, reference: string): string {
    return `pico providers update ${provider} --credential ${reference}`;
}

/**
 * Opens Pico's credential index for one command and closes it again, reporting a credential
 * failure with the code the vault chose so a caller can tell a locked Keychain, a refused item
 * and a missing one apart.
 */
export async function withVault<T>(
    context: HandlerContext,
    options: { allowKeychainUI?: boolean },
    action: (vault: CredentialVault) => T | Promise<T>,
): Promise<T> {
    const vault = context.openVault(options);
    try {
        return await action(vault);
    } catch (error) {
        throw asCliError(error);
    } finally {
        vault.close();
    }
}

/** A `CredentialError` keeps its code, retryability and safe details on the way out. */
export function asCliError(error: unknown): unknown {
    if (!(error instanceof CredentialError)) return error;
    return new CliError(error.code, error.message, {
        retryable: error.retryable,
        details: error.details,
    });
}

export function credentialsList(context: HandlerContext): CommandHandler {
    return async given => {
        const provider = (given.options as CredentialOptions).provider;
        return withVault(context, {}, vault => ({
            revision: vault.revision(),
            items: vault.list(provider).map(projectCredential),
        }));
    };
}

export function credentialsGet(context: HandlerContext): CommandHandler {
    return async given => {
        const options = given.options as CredentialOptions;
        const reference = given.arguments.reference as string;
        return withVault(context, { allowKeychainUI: options.allowKeychainUi === true }, vault => ({
            revision: vault.revision(),
            keychain: "readable" as const,
            item: projectCredential(vault.verify(reference)),
        }));
    };
}

/**
 * Checks the provider, then reads the key, then stores it. The key is read even for a preview,
 * so a preview refuses the same malformed input the real command would, and it is never part of
 * the receipt, the error or the index.
 */
export function credentialsCreate(context: HandlerContext): CommandHandler {
    return async given => {
        const options = given.options as CredentialOptions;
        const provider = options.provider as string;
        if (!describeProvider(provider)) throw unknownProvider(provider);
        const verdict = acceptsApiKey(provider);
        if (!verdict.accepted) {
            throw new CliError("FAILED_PRECONDITION", verdict.reason, {
                details: { provider, argument: "--provider" },
            });
        }
        const key = await context.readStdin();
        return withVault(
            context,
            { allowKeychainUI: options.allowKeychainUi === true },
            async vault => {
                if (options.dryRun === true) {
                    return {
                        provider,
                        dryRun: true,
                        changed: false,
                        keychain: "not-checked" as const,
                        stored: false,
                        revision: vault.revision(),
                        credential: null,
                        select: selectCommand(provider, "<reference>"),
                    };
                }
                // The vault is synchronous: awaiting here would let another writer commit and
                // move the revision between this mutation and the receipt that reports it.
                const created = vault.create(
                    provider,
                    { type: "api_key", key },
                    { ifRevision: options.ifRevision },
                );
                return {
                    provider,
                    dryRun: false,
                    changed: true,
                    keychain: "written" as const,
                    stored: true,
                    revision: vault.revision(),
                    credential: projectCredential(created),
                    select: selectCommand(provider, created.reference),
                };
            },
        );
    };
}

/**
 * Deletes exactly the named credential. A reference Pico does not have is an unchanged receipt
 * rather than a failure, so a deletion interrupted half-way can be finished by repeating it.
 */
export function credentialsDelete(context: HandlerContext): CommandHandler {
    return async given => {
        const options = given.options as CredentialOptions;
        const reference = given.arguments.reference as string;
        return withVault(
            context,
            { allowKeychainUI: options.allowKeychainUi === true },
            async vault => {
                const metadata = vault.metadata(reference);
                if (!metadata) {
                    return {
                        reference,
                        dryRun: options.dryRun === true,
                        changed: false,
                        keychain: "not-checked" as const,
                        revision: vault.revision(),
                        credential: null,
                    };
                }
                if (options.dryRun === true) {
                    // A preview still refuses what the real deletion would refuse.
                    refuseWhenSelected(context.dataDir, metadata);
                    return {
                        reference,
                        dryRun: true,
                        changed: true,
                        keychain: "not-checked" as const,
                        revision: vault.revision(),
                        credential: projectCredential(metadata),
                    };
                }
                const changed = vault.delete(reference, { ifRevision: options.ifRevision });
                return {
                    reference,
                    dryRun: false,
                    changed,
                    keychain: changed ? ("deleted" as const) : ("not-checked" as const),
                    revision: vault.revision(),
                    credential: projectCredential(metadata),
                };
            },
        );
    };
}

/** The vault enforces this on a real deletion; a preview says the same thing without writing. */
function refuseWhenSelected(dataDir: string, metadata: CredentialMetadata): void {
    const bindings = readBindings(dataDir);
    const provider = Object.keys(bindings).find(name => bindings[name] === metadata.reference);
    if (provider === undefined) return;
    throw new CliError(
        "FAILED_PRECONDITION",
        `${provider} still uses ${metadata.reference}; disconnect it or select another credential first.`,
        { details: { reference: metadata.reference, provider } },
    );
}

export function unknownProvider(provider: string): CliError {
    return new CliError("NOT_FOUND", `This Pico's engine declares no provider "${provider}".`, {
        details: { provider, accepted: "pico providers list" },
    });
}
