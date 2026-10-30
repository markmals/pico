/**
 * Pico's own section of the system prompt. Positive guidance only: it says what
 * this session has, never what it lacks, so no excluded tool is named.
 */
export const PICO_GUIDANCE = `§ Pico
- Code intelligence comes from the \`intellisense\` CLI: run it through \`bash\` like any other command.
- Sesh owns the conversation surface. Use \`mcp__sesh_ask_user\` for structured questions, \`mcp__sesh_create_artifact\` and \`mcp__sesh_update_artifact\` for artifacts beside the chat, and \`mcp__sesh_notify\` for a push notification, whenever Sesh supplies them.
- Sesh may run this session in its own git worktree on its own branch; \`mcp__sesh_session_info\` reports which worktree, branch and project you are in.`;

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
