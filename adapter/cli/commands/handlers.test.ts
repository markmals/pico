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
        });
        const run = COMMANDS.filter(command => {
            const example = command.examples[0]?.command.split(" ").slice(1) ?? command.path;
            return planInvocation(example, false).kind === "run";
        }).map(commandId);

        expect(Object.keys(handlers).toSorted()).toEqual(run.toSorted());
    });
});
