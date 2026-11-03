import { describe, expect, test } from "bun:test";

import { commandId } from "../command.ts";
import { planInvocation } from "../plan.ts";
import { COMMANDS } from "../registry.ts";
import { createCommandHandlers } from "./handlers.ts";

describe("proposal.0007 the registry is the only list of commands", () => {
    test("every command the planner runs has a handler, and every handler a command", () => {
        const handlers = createCommandHandlers({
            dataDir: "/nonexistent",
            openCatalog: () => Promise.reject(new Error("not opened")),
            openVault: () => {
                throw new Error("not opened");
            },
            readStdin: () => Promise.reject(new Error("not read")),
        });
        const run = COMMANDS.filter(command => {
            const example = command.examples[0]?.command.split(" ").slice(1) ?? command.path;
            if (planInvocation(example, false).kind !== "run") return false;
            // `auth login` streams; `run.ts` dispatches it rather than a one-document handler.
            return command.outputMode === "document";
        }).map(commandId);

        expect(Object.keys(handlers).toSorted()).toEqual(run.toSorted());
    });
});
