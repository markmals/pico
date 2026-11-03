import type { PicoSessionOptions } from "../engine/pico-session.ts";
import type { PicoSessionFactory } from "./pico-agent.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import { autoBackgroundForSession, savedDefaultForNewSession } from "../engine/saved-default.ts";

type FactoryOptions = Omit<
    PicoSessionOptions,
    "cwd" | "mcpServers" | "sessionManager" | "startOn" | "autoBackground"
>;

/**
 * Pico's sessions: a new one starts on the default saved at that moment, and a reopened one on its
 * own journal (proposal.0007). Every attach reads the auto-background setting saved at that moment
 * (proposal.0008).
 */
export function picoSessionFactory(options: FactoryOptions): PicoSessionFactory {
    return async (cwd, mcpServers, sessionManager, fresh) =>
        createPicoSession({
            ...options,
            cwd,
            mcpServers,
            sessionManager,
            startOn: fresh ? savedDefaultForNewSession(options.dataDir) : undefined,
            autoBackground: autoBackgroundForSession(options.dataDir, fresh),
        });
}
