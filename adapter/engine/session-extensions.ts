// Derived from oh-my-pi 18.14.0 src/extensibility/extensions/loader.ts (MIT; see THIRD-PARTY-NOTICES.md).
import type { Settings } from "@oh-my-pi/pi-coding-agent";
import type { PreparedExtension } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

import { discoverSessionExtensionPaths } from "@oh-my-pi/pi-coding-agent";
import { loadLegacyPiModule } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/legacy-pi-compat";
import { resolvePath, withHostGuard } from "@oh-my-pi/pi-coding-agent/extensibility/utils";

import { describeCause } from "./errors.ts";

/**
 * A restricted session never runs ambient extension discovery (`sdk.ts:2831`);
 * it binds only the prepared factories its host hands it. Pico therefore runs
 * the discovery itself, imports each module exactly once, and passes the
 * factories on, so user and project hooks keep working while their tools stay
 * unexposed. An extension that fails to load is skipped and reported; the
 * session still starts, as it does in terminal OMP.
 */
export async function prepareDiscoveredExtensions(
    cwd: string,
    settings: Settings,
): Promise<PreparedExtension[]> {
    const paths = await discoverSessionExtensionPaths({}, cwd, settings);
    const imported = await Promise.all(
        paths.map(extensionPath => importExtension(extensionPath, cwd)),
    );
    return imported.filter(prepared => prepared !== undefined);
}

/**
 * Mirrors OMP's own `importExtensionModule`, which the package does not export.
 * The host guard is the load-bearing part: without it an extension that calls
 * `process.exit` or grabs `process.stdin` while being imported takes Pico's
 * process — and the ACP stream on its stdio — with it.
 */
async function importExtension(
    extensionPath: string,
    cwd: string,
): Promise<PreparedExtension | undefined> {
    try {
        const resolvedPath = resolvePath(extensionPath, cwd);
        const module = await withHostGuard(() => loadLegacyPiModule(resolvedPath));
        const candidate =
            typeof module === "function" ? module : (module as { default?: unknown }).default;
        if (typeof candidate !== "function") {
            report(extensionPath, "it exports no factory function");
            return undefined;
        }
        return {
            path: extensionPath,
            resolvedPath,
            factory: candidate as PreparedExtension["factory"],
            error: null,
        };
    } catch (error) {
        report(extensionPath, describeCause(error));
        return undefined;
    }
}

function report(extensionPath: string, reason: string): void {
    process.stderr.write(`pico: skipped extension ${extensionPath}: ${reason}\n`);
}
