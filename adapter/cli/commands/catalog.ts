import path from "node:path";

import type { OpenedCatalog } from "./handlers.ts";

import { CredentialStoreError, openCredentialStore } from "../../engine/credential-store.ts";
import { createPicoModelRegistry } from "../../engine/model-catalog.ts";
import { CliError } from "../errors.ts";

/** SQLite's words for a store another process holds; only then can a retry succeed. */
const BUSY = /SQLITE_BUSY|database is (busy|locked)/i;

/** The catalog `pico` commands read: the user's OMP credential store, as sessions open it. */
export function userCatalog(userAgentDir: string, dataDir: string): () => Promise<OpenedCatalog> {
    return async () => {
        try {
            const authStorage = await openCredentialStore(userAgentDir);
            const registry = createPicoModelRegistry(authStorage, dataDir);
            return { registry, credentialStore: path.join(userAgentDir, "agent.db") };
        } catch (error) {
            if (!(error instanceof CredentialStoreError)) throw error;
            throw new CliError("UNAVAILABLE", error.message, {
                // The store's own cause alone decides: the message also carries the user's path.
                retryable: BUSY.test(error.storeCause),
                details: { credentialStore: error.storePath, cause: error.storeCause },
            });
        }
    };
}
