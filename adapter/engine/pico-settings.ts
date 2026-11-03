import { Settings } from "@oh-my-pi/pi-coding-agent";

/**
 * The capability providers that read OMP's own configuration: everything under `~/.omp/agent`
 * and a project's `.omp` (`native`), configured extension packages (`omp-plugins`) and
 * auto-learned skills (`omp-managed`). `AGENTS.md`, `.agents` and other harnesses' folders come
 * from other providers and still load (proposal.0007).
 */
const OMP_CONFIGURATION_PROVIDERS = ["native", "omp-plugins", "omp-managed"];

/**
 * OMP's built-in defaults with Pico's policy on top, reading no OMP settings file: the excluded
 * subsystems are off, nothing gates a tool call because Pico never asks for approval and has no
 * UI to ask with, and `todo` is always on without the reminders that would continue a turn the
 * model ended or the hidden title requests a new list would start (proposal.0006).
 */
export function picoSettings(): Settings {
    return Settings.isolated({
        "eval.py": false,
        "eval.js": false,
        "lsp.enabled": false,
        "task.maxRecursionDepth": 0,
        "tools.approvalMode": "yolo",
        "tools.restrictedFolders": [],
        "todo.enabled": true,
        "todo.reminders": false,
        "title.refreshOnReplan": false,
        disabledProviders: OMP_CONFIGURATION_PROVIDERS,
    });
}
