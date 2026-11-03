import path from "node:path";

import type { OpenedCatalog } from "./handlers.ts";

import { openCredentialStore } from "../../engine/credential-store.ts";
import { PicoSessionError } from "../../engine/errors.ts";
import { createPicoModelRegistry } from "../../engine/model-catalog.ts";
import { CliError } from "../errors.ts";

/** SQLite's words for a store another process holds; only then can a retry succeed. */
const BUSY = /SQLITE_BUSY|database is locked|busy/i;

/** The catalog `pico` commands read: the user's OMP credential store, as sessions open it. */
export function userCatalog(userAgentDir: string, dataDir: string): () => Promise<OpenedCatalog> {
    return async () => {
        const credentialStore = path.join(userAgentDir, "agent.db");
        try {
            const authStorage = await openCredentialStore(userAgentDir);
            return { registry: createPicoModelRegistry(authStorage, dataDir), credentialStore };
        } catch (error) {
            if (!(error instanceof PicoSessionError)) throw error;
            throw new CliError("UNAVAILABLE", error.message, {
                retryable: BUSY.test(error.message),
                details: { credentialStore, cause: error.message },
            });
        }
    };
}
