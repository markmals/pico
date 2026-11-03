import path from "node:path";

import type { CommandInput } from "../command.ts";
import type { CliError } from "../errors.ts";
import type { CommandHandlers, HandledCommand } from "./handlers.ts";

import { createPicoModelRegistry } from "../../engine/model-catalog.ts";
import {
    type Cleanups,
    picoWorkspace,
    unauthenticatedAuthStorage,
    withoutProviderCredentials,
} from "../../engine/testing/session-fixture.ts";
import { testProvider } from "../../engine/testing/test-provider.ts";
import { COMMANDS } from "../registry.ts";
import { createCommandHandlers } from "./handlers.ts";

/** Handlers over a scratch data directory and a catalog holding only `pico-test/alpha` and `beta`. */
export async function testHandlers(t: Cleanups) {
    withoutProviderCredentials(t);
    const workspace = picoWorkspace(t);
    const authStorage = await unauthenticatedAuthStorage(workspace.agentDir);
    t.after(() => authStorage.close());
    const registry = createPicoModelRegistry(authStorage, workspace.dataDir);
    testProvider().register(registry);
    const credentialStore = path.join(workspace.agentDir, "agent.db");
    const handlers = createCommandHandlers({
        dataDir: workspace.dataDir,
        openCatalog: async () => ({ registry, credentialStore }),
    });
    return { ...workspace, registry, authStorage, credentialStore, handlers };
}

export function input(
    options: CommandInput["options"] = {},
    args: CommandInput["arguments"] = {},
): CommandInput {
    return { arguments: args, options };
}

/** The CliError a handler threw, checked against the codes its command declares. */
export async function rejection(
    handlers: CommandHandlers,
    command: HandledCommand,
    given: CommandInput,
): Promise<CliError> {
    const declared = COMMANDS.find(spec => spec.path.join(" ") === command)?.errors ?? [];
    try {
        await handlers[command](given);
    } catch (error) {
        const failure = error as CliError;
        if (!declared.some(spec => spec.code === failure.code)) {
            throw new Error(`${command} threw undeclared ${failure.code}: ${failure.message}`);
        }
        return failure;
    }
    throw new Error(`${command} succeeded`);
}
