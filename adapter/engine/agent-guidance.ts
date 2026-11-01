export const PICO_GUIDANCE = `§ Pico
- Code intelligence comes from the \`intellisense\` CLI: run it through \`bash\` like any other command.
- Sesh owns the conversation surface. Use \`mcp__sesh_ask_user\` for structured questions, \`mcp__sesh_create_artifact\` and \`mcp__sesh_update_artifact\` for artifacts beside the chat, and \`mcp__sesh_notify\` for a push notification, whenever Sesh supplies them.
- Sesh may run this session in its own git worktree on its own branch; \`mcp__sesh_session_info\` reports which worktree, branch and project you are in.
- Delegate reviews and other work only through \`mcp__sesh_start_session\`, when Sesh supplies it. Children inherit this session's registered Pico agent; omit the \`agent\` field.
- Never launch agent harnesses through \`bash\` or native workers as a delegation fallback. If Sesh delegation is unavailable or fails, report the limitation or do the work in this session.`;

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
