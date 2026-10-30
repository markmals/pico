// Derived from oh-my-pi 18.14.0 src/extensibility/extensions/loader.ts (MIT; see THIRD-PARTY-NOTICES.md).
import type { Settings } from "@oh-my-pi/pi-coding-agent";
import type { PreparedExtension } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import { discoverSessionExtensionPaths } from "@oh-my-pi/pi-coding-agent";
import { loadLegacyPiModule } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/legacy-pi-compat";
import path from "node:path";

import { describeCause } from "./errors.ts";

/**
 * A restricted session never runs ambient extension discovery (`sdk.ts:2831`);
 * it binds only the prepared factories its host hands it. Pico therefore runs
 * the discovery itself, imports each module exactly once, and passes the
 * factories on, so user and project hooks keep working while their tools stay
 * unexposed.
 */
export async function prepareDiscoveredExtensions(
    cwd: string,
    settings: Settings,
): Promise<PreparedExtension[]> {
    const paths = await discoverSessionExtensionPaths({}, cwd, settings);
    return await Promise.all(paths.map(extensionPath => importExtension(extensionPath, cwd)));
}

/** Mirrors OMP's own `importExtensionModule`, which the package does not export. */
async function importExtension(extensionPath: string, cwd: string): Promise<PreparedExtension> {
    const resolvedPath = path.resolve(cwd, extensionPath);
    try {
        const module = await loadLegacyPiModule(resolvedPath);
        const candidate =
            typeof module === "function" ? module : (module as { default?: unknown }).default;
        if (typeof candidate !== "function") {
            return {
                path: extensionPath,
                resolvedPath,
                factory: null,
                error: `Extension does not export a valid factory function: ${extensionPath}`,
            };
        }
        return {
            path: extensionPath,
            resolvedPath,
            factory: candidate as PreparedExtension["factory"],
            error: null,
        };
    } catch (error) {
        return {
            path: extensionPath,
            resolvedPath,
            factory: null,
            error: `Failed to load extension: ${describeCause(error)}`,
        };
    }
}
