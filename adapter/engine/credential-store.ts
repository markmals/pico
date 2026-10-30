import type { AuthStorage } from "@oh-my-pi/pi-ai";

import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import path from "node:path";

import { describeCause, PicoSessionError } from "./errors.ts";

/** SQLite and the filesystem both report a sandboxed `~/.omp` this way. */
const WRITE_DENIED = /readonly|read-only|permission denied|EACCES|EPERM|EROFS/i;

const AUTONOMOUS_NOTE =
    "Sesh's Autonomous sandbox blocks writes to ~/.omp, and Pico does not support Autonomous sessions yet.";

/** Opens the user's OMP credential store in place, as terminal OMP does. */
export async function openCredentialStore(agentDir: string): Promise<AuthStorage> {
    try {
        return await discoverAuthStorage(agentDir);
    } catch (error) {
        const cause = describeCause(error);
        const storePath = path.join(agentDir, "agent.db");
        const explanation = WRITE_DENIED.test(cause) ? ` ${AUTONOMOUS_NOTE}` : "";
        throw new PicoSessionError(
            `Could not open the Oh My Pi credential store at ${storePath}: ${cause}.${explanation}`,
        );
    }
}
