import type { PicoSessionOptions } from "../engine/pico-session.ts";
import type { PicoSessionFactory } from "./pico-agent.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import { savedDefaultForNewSession } from "../engine/saved-default.ts";

type FactoryOptions = Omit<PicoSessionOptions, "cwd" | "mcpServers" | "sessionManager" | "startOn">;

/**
 * Pico's sessions: a new one starts on the default saved at that moment, and a reopened one on
 * its own journal, without reading the settings file at all (proposal.0007).
 */
export function picoSessionFactory(options: FactoryOptions): PicoSessionFactory {
    return async (cwd, mcpServers, sessionManager, fresh) =>
        createPicoSession({
            ...options,
            cwd,
            mcpServers,
            sessionManager,
            startOn: fresh ? savedDefaultForNewSession(options.dataDir) : undefined,
        });
}
