import type { IntellisenseEnvironment } from "../../intellisense/location.ts";
import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import { processEnvironment, resolveIntellisense } from "../../intellisense/location.ts";
import { readIntellisenseVersion, VERSION_TIMEOUT_MS } from "../../intellisense/version.ts";
import { settingsFilePath } from "../../settings/settings-store.ts";
import { CliError } from "../errors.ts";
import { readSettingsFile } from "./settings-file.ts";

/** What the check runs against; production uses the process's own environment and deadline. */
export interface IntellisenseProbe {
    environment?: IntellisenseEnvironment;
    timeoutMs?: number;
}

/**
 * Reads the settings file, resolves the location a new session would use, and proves a found
 * one by running it. It needs no engine, no catalog and no Keychain.
 */
export function intellisenseCheck(
    context: Pick<HandlerContext, "dataDir">,
    probe: IntellisenseProbe = {},
): CommandHandler {
    return async () => {
        const settingsFile = settingsFilePath(context.dataDir);
        const state = readSettingsFile(context.dataDir);
        if ("problem" in state) {
            throw new CliError(
                "FAILED_PRECONDITION",
                `Pico's settings file ${settingsFile} cannot be used: ${state.problem}. Fix or remove it first.`,
                { details: { settingsFile, problem: state.problem } },
            );
        }
        const location = resolveIntellisense(
            state.item.intellisensePath,
            probe.environment ?? processEnvironment(),
        );
        if (location.status !== "found") return { settingsFile, ...location };
        const result = await readIntellisenseVersion(
            location.path,
            probe.timeoutMs ?? VERSION_TIMEOUT_MS,
        );
        if ("problem" in result) {
            return {
                settingsFile,
                status: "unusable",
                source: location.source,
                path: location.path,
                problem: result.problem,
            };
        }
        return {
            settingsFile,
            status: "ready",
            source: location.source,
            path: location.path,
            version: result.version,
        };
    };
}
