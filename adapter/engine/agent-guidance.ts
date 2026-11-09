export const PICO_GUIDANCE = `§ Pico
- Code intelligence comes from the \`intellisense\` CLI: run it through \`bash\` like any other command.
- Sesh owns the conversation surface. Use \`mcp__sesh_ask_user\` for structured questions, \`mcp__sesh_create_artifact\` and \`mcp__sesh_update_artifact\` for artifacts beside the chat, and \`mcp__sesh_notify\` for a push notification, whenever Sesh supplies them.
- Sesh may run this session in its own git worktree on its own branch; \`mcp__sesh_session_info\` reports which worktree, branch and project you are in.
- Delegate reviews and other work only through \`mcp__sesh_start_session\`, when Sesh supplies it. Children inherit this session's registered Pico agent; omit the \`agent\` field.
- Each child starts in a new worktree on a new branch from this session's last commit, so commit before delegating anything the child must see: a launch from a checkout with uncommitted changes fails. A child's commits stay on its branch for deliberate integration. Once a child's turn ends without changes, Pico removes its worktree, so give each child a complete task rather than planning follow-ups.
- Never launch agent harnesses through \`bash\` or native workers as a delegation fallback. If Sesh delegation is unavailable or fails, report the limitation or do the work in this session.
- Keep the \`todo\` list flat: create it with \`init\` and \`items\` (no \`list\`), and add tasks with \`append\` and \`phase: "Tasks"\`. Sesh shows the list as a plan without phase names.
- A background \`bash\` job belongs to the turn that started it: Sesh shows the turn as running until every job ends, and stopping the turn kills them. Don't start a server or watcher in the background expecting it to outlive your reply.`;

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
