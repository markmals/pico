import type { AuthStorage } from "@oh-my-pi/pi-ai";

import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import path from "node:path";

import { describeCause, PicoSessionError } from "./errors.ts";

/** SQLite and the filesystem both report a sandboxed `~/.omp` this way. */
const WRITE_DENIED = /readonly|read-only|permission denied|EACCES|EPERM|EROFS/i;

const AUTONOMOUS_NOTE =
    "Sesh's Autonomous sandbox blocks writes to ~/.omp, and Pico does not support Autonomous sessions yet.";

/** The credential store could not be opened; `storeCause` is what the store itself reported. */
export class CredentialStoreError extends PicoSessionError {
    readonly storePath: string;
    readonly storeCause: string;

    constructor(storePath: string, storeCause: string) {
        const explanation = WRITE_DENIED.test(storeCause) ? ` ${AUTONOMOUS_NOTE}` : "";
        super(
            `Could not open the Oh My Pi credential store at ${storePath}: ${storeCause}.${explanation}`,
        );
        this.storePath = storePath;
        this.storeCause = storeCause;
    }
}

/** Opens the user's OMP credential store in place, as terminal OMP does. */
export async function openCredentialStore(agentDir: string): Promise<AuthStorage> {
    try {
        return await discoverAuthStorage(agentDir);
    } catch (error) {
        throw new CredentialStoreError(path.join(agentDir, "agent.db"), describeCause(error));
    }
}
