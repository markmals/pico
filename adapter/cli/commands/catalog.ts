import type { OpenedCatalog } from "./handlers.ts";

import { CredentialError } from "../../credentials/errors.ts";
import { openPicoCredentials } from "../../engine/credential-policy.ts";
import { SettingsIoError, SettingsUnusableError } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";

/**
 * The catalog `pico` commands read: Pico's own Keychain-backed credentials and the providers
 * its settings bind them to, exactly as a session resolves them (proposal.0009).
 */
export function picoCatalog(dataDir: string): () => Promise<OpenedCatalog> {
    return async () => {
        try {
            const credentials = await openPicoCredentials({ dataDir });
            return {
                registry: credentials.registry,
                providerCredentials: credentials.providerCredentials(),
            };
        } catch (error) {
            throw catalogError(error);
        }
    };
}

/**
 * The vault's own code survives: a locked Keychain, a denied item and a missing credential are
 * different conditions a caller acts on differently. Settings Pico cannot use are a precondition
 * the caller fixes in the file itself.
 */
function catalogError(error: unknown): unknown {
    if (error instanceof CredentialError) {
        return new CliError(error.code, error.message, {
            retryable: error.retryable,
            details: error.details,
        });
    }
    if (error instanceof SettingsUnusableError) {
        return new CliError(
            "FAILED_PRECONDITION",
            `Pico's settings file ${error.path} cannot be used: ${error.problem}. Fix or remove it first.`,
            { details: { settingsFile: error.path, problem: error.problem } },
        );
    }
    if (error instanceof SettingsIoError) {
        return new CliError("IO_ERROR", `Pico ${error.message}`, {
            details: { path: error.path, cause: error.cause },
        });
    }
    return error;
}
