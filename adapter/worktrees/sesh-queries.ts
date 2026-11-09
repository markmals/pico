import type { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";

import { z } from "@oh-my-pi/pi-coding-agent";
import { callTool } from "@oh-my-pi/pi-coding-agent/mcp";

const projectList = z.object({
    projects: z.array(z.object({ name: z.string(), path: z.string() })),
});

const childList = z.object({
    sessions: z.array(
        z.object({
            cwd: z.string().optional(),
            state: z.string(),
            lastReply: z.string().nullable().optional(),
        }),
    ),
});

export type SeshProject = z.infer<typeof projectList>["projects"][number];
export type SeshChild = z.infer<typeof childList>["sessions"][number];

/** The parts of Sesh's session-management tools Pico reads for itself (proposal.0010). */
export interface SeshQueries {
    /** The projects Sesh knows on this machine. */
    projects(): Promise<SeshProject[]>;
    /** The sessions this parent started, archived ones excluded, as Sesh reports them now. */
    children(): Promise<SeshChild[]>;
}

export function seshQueries(manager: MCPManager): SeshQueries {
    /** A Sesh tool's structured answer; Sesh's text rendering of it is for people. */
    const ask = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
        const connection = manager.getConnection("sesh");
        if (!connection) throw new Error(`Sesh's ${tool} isn't available in this session.`);
        const result = await callTool(connection, tool, args);
        const text = result.content.flatMap(item => (item.type === "text" ? [item.text] : []));
        if (result.isError) throw new Error(`Sesh's ${tool} failed: ${text.join("\n")}`);
        return result.structuredContent;
    };
    const unrecognized = (tool: string, message: string) =>
        new Error(`Sesh's ${tool} answered in a form Pico doesn't recognize: ${message}`);
    return {
        projects: async () => {
            const parsed = projectList.safeParse(await ask("list_projects", {}));
            if (!parsed.success) throw unrecognized("list_projects", parsed.error.message);
            return parsed.data.projects;
        },
        children: async () => {
            const parsed = childList.safeParse(await ask("list_sessions", { children: true }));
            if (!parsed.success) throw unrecognized("list_sessions", parsed.error.message);
            return parsed.data.sessions;
        },
    };
}
