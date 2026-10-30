import { describe, expect, test } from "bun:test";

import { textDelta, thinkingDelta, toolCallStreamDeltas } from "./engine-event-fixtures.ts";
import { SessionEventMapper } from "./session-event-mapper.ts";

function mapper(): SessionEventMapper {
    return new SessionEventMapper({
        cwd: "/workspace",
        takeChanges: () => [],
        mcpToolIdentity: () => undefined,
    });
}

describe("proposal.0001 assistant message streaming", () => {
    test("an assistant text delta becomes an agent_message_chunk", () => {
        const updates = mapper().map(textDelta("Hello"));

        expect(updates).toHaveLength(1);
        expect(updates[0]?.sessionUpdate).toBe("agent_message_chunk");
        expect(updates[0]).toMatchObject({ content: { type: "text", text: "Hello" } });
    });

    test("a thinking delta becomes an agent_thought_chunk", () => {
        const updates = mapper().map(thinkingDelta("weighing the options"));

        expect(updates).toHaveLength(1);
        expect(updates[0]?.sessionUpdate).toBe("agent_thought_chunk");
        expect(updates[0]).toMatchObject({
            content: { type: "text", text: "weighing the options" },
        });
    });

    test("deltas keep their arrival order across one assistant message", () => {
        const subject = mapper();

        const kinds = [thinkingDelta("plan"), textDelta("one"), textDelta("two")].flatMap(event =>
            subject.map(event).map(update => update.sessionUpdate),
        );

        expect(kinds).toEqual([
            "agent_thought_chunk",
            "agent_message_chunk",
            "agent_message_chunk",
        ]);
    });

    test("model-stream tool-call deltas produce no updates", () => {
        const subject = mapper();

        const updates = toolCallStreamDeltas("write", { path: "a.txt", content: "hi\n" }).flatMap(
            event => subject.map(event),
        );

        expect(updates).toEqual([]);
    });
});
