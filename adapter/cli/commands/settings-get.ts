import type { CommandHandler } from "../execute.ts";
import type { HandlerContext } from "./handlers.ts";

import { settingsFilePath } from "../../settings/settings-store.ts";
import { effectiveDefault, readSettingsFile } from "./settings-file.ts";

export function settingsGet(context: HandlerContext): CommandHandler {
    return async () => {
        const settingsFile = settingsFilePath(context.dataDir);
        const state = readSettingsFile(context.dataDir);
        if ("problem" in state) {
            const { status, revision, problem } = state;
            return { settingsFile, status, revision, item: null, effective: null, problem };
        }
        const { registry } = await context.openCatalog();
        return {
            settingsFile,
            status: state.status,
            revision: state.revision,
            item: state.item,
            effective: await effectiveDefault(registry, state.item),
        };
    };
}
