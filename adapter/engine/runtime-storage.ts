// Keep imports side-effect-free: main loads this module before isolating stdout.

import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";
import fs from "node:fs";
import path from "node:path";

// setAgentDir overwrites these, but child processes must retain the user's configuration.
const INHERITED_DIRECTORY_VARIABLES = ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE"];

/** Redirects SDK runtime storage once per process and returns the original configuration source. */
export function initializeRuntimeStorage(dataDir: string): string {
    const configSource = getAgentDir();
    const engineDir = path.join(dataDir, "engine");
    fs.mkdirSync(engineDir, { recursive: true, mode: 0o700 });
    const inherited = INHERITED_DIRECTORY_VARIABLES.map(
        variable => [variable, process.env[variable]] as const,
    );
    setAgentDir(engineDir);
    for (const [variable, value] of inherited) {
        if (value === undefined) delete process.env[variable];
        else process.env[variable] = value;
    }
    return configSource;
}
