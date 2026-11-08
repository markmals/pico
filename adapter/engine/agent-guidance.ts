import type { IntellisenseLocation } from "../intellisense/location.ts";

/** A word a POSIX shell takes literally, so a path made only of these needs no quoting. */
const BARE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Pico's own instructions, whose first bullet is the `intellisense` location this session
 * resolved: the agent is told where to run it, or why it cannot (pico-bfk.20).
 */
export function picoGuidance(intellisense: IntellisenseLocation): string {
    return `§ Pico
${intellisenseBullet(intellisense)}
- Sesh owns the conversation surface. Use \`mcp__sesh_ask_user\` for structured questions, \`mcp__sesh_create_artifact\` and \`mcp__sesh_update_artifact\` for artifacts beside the chat, and \`mcp__sesh_notify\` for a push notification, whenever Sesh supplies them.
- Sesh may run this session in its own git worktree on its own branch; \`mcp__sesh_session_info\` reports which worktree, branch and project you are in.
- Delegate reviews and other work only through \`mcp__sesh_start_session\`, when Sesh supplies it. Children inherit this session's registered Pico agent; omit the \`agent\` field.
- Never launch agent harnesses through \`bash\` or native workers as a delegation fallback. If Sesh delegation is unavailable or fails, report the limitation or do the work in this session.
- Keep the \`todo\` list flat: create it with \`init\` and \`items\` (no \`list\`), and add tasks with \`append\` and \`phase: "Tasks"\`. Sesh shows the list as a plan without phase names.
- A background \`bash\` job belongs to the turn that started it: Sesh shows the turn as running until every job ends, and stopping the turn kills them. Don't start a server or watcher in the background expecting it to outlive your reply.`;
}

function intellisenseBullet(location: IntellisenseLocation): string {
    if (location.status === "found") {
        return `- Code intelligence comes from the \`intellisense\` CLI at ${location.path}: run it through \`bash\` as ${shellWord(location.path)}, since it may not be on \`PATH\`.`;
    }
    return `- Code intelligence comes from the \`intellisense\` CLI, but Pico has no usable copy: ${location.problem}. Don't search for another copy. When you need it, tell the user to choose it in Pico's Tools & Integrations settings or with \`pico settings update --intellisense-path\`.`;
}

function shellWord(path: string): string {
    if (BARE_WORD.test(path)) return path;
    return `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * The default prompt blocks with the `agent://` internal-URL line removed and
 * nothing else changed: it describes subagent output, and Pico has no subagents.
 */
export function withoutSubagentUrl(defaultPrompt: string[]): string[] {
    return defaultPrompt.map(block =>
        block
            .split("\n")
            .filter(line => !line.includes("agent://"))
            .join("\n"),
    );
}
