import type { MemorySecretStore } from "../../credentials/testing/memory-secret-store.ts";
import type { CommandInput } from "../command.ts";
import type { CliError } from "../errors.ts";
import type { CommandHandlers, HandledCommand } from "./handlers.ts";

import { createMemorySecretStore } from "../../credentials/testing/memory-secret-store.ts";
import { openCredentialVault } from "../../credentials/vault.ts";
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

/**
 * Handlers over a scratch data directory, a catalog holding only `pico-test/alpha` and `beta`,
 * and a real credential vault whose Keychain is an isolated in-memory store. Nothing here
 * reaches the user's Keychain, settings or OMP installation.
 */
export async function testHandlers(t: Cleanups, options: { stdin?: string } = {}) {
    withoutProviderCredentials(t);
    const workspace = picoWorkspace(t);
    const authStorage = await unauthenticatedAuthStorage(workspace.dataDir);
    const registry = createPicoModelRegistry(authStorage, workspace.dataDir);
    testProvider().register(registry);
    const keychain: MemorySecretStore = createMemorySecretStore();
    const vaults: { close(): void }[] = [];
    t.after(() => {
        for (const vault of vaults.splice(0)) vault.close();
    });
    const handlers = createCommandHandlers({
        dataDir: workspace.dataDir,
        openCatalog: async () => ({ registry, providerCredentials: {} }),
        openVault: vaultOptions => {
            const vault = openCredentialVault({
                dataDir: workspace.dataDir,
                keychain,
                allowKeychainUI: vaultOptions?.allowKeychainUI,
            });
            vaults.push(vault);
            return vault;
        },
        readStdin: async () => {
            if (options.stdin === undefined) throw new Error("the test supplied no stdin");
            return options.stdin;
        },
    });
    return { ...workspace, registry, authStorage, keychain, handlers };
}

/** A vault over the same data directory, for a test that sets up or inspects stored state. */
export function testVault(t: Cleanups, dataDir: string, keychain: MemorySecretStore) {
    const vault = openCredentialVault({ dataDir, keychain });
    t.after(() => vault.close());
    return vault;
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
