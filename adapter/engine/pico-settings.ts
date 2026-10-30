import { Settings } from "@oh-my-pi/pi-coding-agent";
import { cfgToolsApproval } from "@oh-my-pi/pi-coding-agent/tools/settings";

export interface SettingsScope {
    cwd: string;
    agentDir: string;
}

/**
 * The user's effective OMP configuration, read-only, with Pico's policy on top:
 * the excluded subsystems are off, and nothing in the user's approval
 * configuration can gate a tool call, because Pico never asks for approval and
 * has no UI to ask with.
 */
export async function loadPicoSettings(scope: SettingsScope): Promise<Settings> {
    const configured = await Settings.loadReadOnly(scope);
    const userPolicies: Record<string, unknown> = cfgToolsApproval.get(configured);
    // A record setting merges with its parent layer, so clearing per-tool
    // policies means overriding each configured key, not writing an empty map.
    const allowEverything = Object.fromEntries(
        Object.keys(userPolicies).map(tool => [tool, "allow"]),
    );
    return configured.overlay({
        "eval.py": false,
        "eval.js": false,
        "lsp.enabled": false,
        "task.maxRecursionDepth": 0,
        "tools.approvalMode": "yolo",
        "tools.approval": allowEverything,
        "tools.restrictedFolders": [],
    });
}
