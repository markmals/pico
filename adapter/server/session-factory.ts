import type { PicoSessionOptions } from "../engine/pico-session.ts";
import type { PicoSessionFactory } from "./pico-agent.ts";

import { createPicoSession } from "../engine/pico-session.ts";
import {
    autoBackgroundForSession,
    intellisenseForSession,
    savedDefaultForNewSession,
} from "../engine/saved-default.ts";

type FactoryOptions = Omit<
    PicoSessionOptions,
    "cwd" | "mcpServers" | "sessionManager" | "startOn" | "autoBackground" | "intellisense"
>;

/**
 * Pico's sessions: a new one starts on the default saved at that moment, and a reopened one on its
 * own journal (proposal.0007). Every attach reads the auto-background setting saved at that moment
 * (proposal.0008) and resolves the `intellisense` location afresh (pico-bfk.20).
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
            intellisense: intellisenseForSession(options.dataDir, fresh),
        });
}
