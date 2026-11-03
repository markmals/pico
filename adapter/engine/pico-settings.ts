import { Settings } from "@oh-my-pi/pi-coding-agent";

/**
 * The capability providers that read OMP's own configuration: everything under `~/.omp/agent`
 * and a project's `.omp` (`native`), configured extension packages (`omp-plugins`) and
 * auto-learned skills (`omp-managed`). `AGENTS.md`, `.agents` and other harnesses' folders come
 * from other providers and still load (proposal.0007).
 */
const OMP_CONFIGURATION_PROVIDERS = ["native", "omp-plugins", "omp-managed"];

/** OMP's threshold for moving a plain command to the background, fixed by Pico (proposal.0008). */
const AUTO_BACKGROUND_THRESHOLD_MS = 60_000;

/**
 * OMP's built-in defaults with Pico's policy on top, reading no OMP settings file: the excluded
 * subsystems are off, nothing gates a tool call because Pico never asks for approval and has no
 * UI to ask with, and `todo` is always on without the reminders that would continue a turn the
 * model ended or the hidden title requests a new list would start (proposal.0006). Background
 * jobs and `wait` are on and service mode is off, with every value they depend on Pico's own;
 * `autoBackground` is the session's setting from Pico's settings file (proposal.0008).
 */
export function picoSettings(autoBackground: boolean): Settings {
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
        "async.enabled": true,
        "async.maxJobs": 100,
        "launch.enabled": false,
        "bash.autoBackground.enabled": autoBackground,
        "bash.autoBackground.thresholdMs": AUTO_BACKGROUND_THRESHOLD_MS,
        disabledProviders: OMP_CONFIGURATION_PROVIDERS,
    });
}
