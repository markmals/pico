import { VERSION } from "@oh-my-pi/pi-coding-agent";

import type { CommandHandler } from "../execute.ts";

import manifest from "../../../package.json" with { type: "json" };

export function versionGet(): CommandHandler {
    return async () => ({ item: { pico: manifest.version, omp: VERSION } });
}
