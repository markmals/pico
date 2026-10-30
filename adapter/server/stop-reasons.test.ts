import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { assistantText, INTERNAL_ERROR, requestError } from "./agent-harness.ts";
import { removeTemporaryDirectories } from "./engine-harness.ts";
import { closeOpenConnections, startPicoSession, updateKinds } from "./session-fixture.ts";

afterEach(closeOpenConnections);

afterAll(removeTemporaryDirectories);

describe("proposal.0001 stop reasons", () => {
    test("a turn that completes normally ends the turn", async () => {
        const session = await startPicoSession([{ content: ["All done."] }]);

        const response = await session.prompt("hello");

        expect(response.stopReason).toBe("end_turn");
        expect(assistantText(session.updates())).toBe("All done.");
    });

    test("an assistant message cut off by the output limit reports max_tokens", async () => {
        const session = await startPicoSession([
            { content: ["half an ans"], stopReason: "length" },
        ]);

        const response = await session.prompt("write an essay");

        expect(response.stopReason).toBe("max_tokens");
    });

    test("an explicit refusal reports refusal", async () => {
        const session = await startPicoSession([
            {
                stopReason: "error",
                stopDetails: { type: "refusal" },
                errorMessage: "I cannot help with that.",
            },
        ]);

        const response = await session.prompt("do something forbidden");

        expect(response.stopReason).toBe("refusal");
    });

    test("a turn the engine aborted without a cancellation fails the prompt", async () => {
        const session = await startPicoSession([
            { stopReason: "aborted", errorMessage: "the engine stopped the turn" },
        ]);

        const error = await requestError(session.prompt("hello"));

        expect(error.code).toBe(INTERNAL_ERROR);
        expect(error.message).toContain("the engine stopped the turn");
    });
});

describe("proposal.0001 provider failures", () => {
    test("a provider failure fails the prompt with the engine's error message", async () => {
        const session = await startPicoSession([
            { throw: "401 Unauthorized: credentials were revoked" },
        ]);

        const error = await requestError(session.prompt("hello"));

        expect(error.code).toBe(INTERNAL_ERROR);
        expect(error.message).toContain("401 Unauthorized: credentials were revoked");
    });

    test("updates sent before a failure stay sent", async () => {
        const session = await startPicoSession([
            {
                content: [
                    "Writing the file.",
                    {
                        type: "toolCall",
                        name: "write",
                        arguments: { path: "a.txt", content: "hi\n" },
                    },
                ],
            },
            { throw: "the provider went away" },
        ]);

        const error = await requestError(session.prompt("write a file"));

        expect(error.message).toContain("the provider went away");
        expect(assistantText(session.updates())).toContain("Writing the file.");
        expect(updateKinds(session.updates())).toContain("tool_call");
    });
});
