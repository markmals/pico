/** The built-in tools every Pico session carries. Everything else OMP offers is excluded or deferred. */
export const PICO_BUILTIN_TOOLS = ["read", "grep", "glob", "edit", "write", "bash", "web_search"];

/**
 * The active tools that the allowlist does not cover, each named once in the
 * order it was active. `toolNames` alone is not a guarantee: MCP tools are
 * mounted after creation, and a future OMP release could admit a built-in Pico
 * never asked for, so the roster is compared against the allowlist rather than
 * assumed from it.
 */
export function findUnexpectedTools(
    activeToolNames: readonly string[],
    allowedToolNames: readonly string[],
): string[] {
    const allowed = new Set(allowedToolNames);
    const unexpected: string[] = [];
    for (const name of activeToolNames) {
        if (allowed.has(name) || unexpected.includes(name)) continue;
        unexpected.push(name);
    }
    return unexpected;
}
