// Metadata and previews must not initialize the engine or consult a model catalog.

import type { CommandInput } from "../command.ts";
import type { HandlerContext } from "./handlers.ts";

import { openCredentialVault } from "../../credentials/vault.ts";
import { CliError } from "../errors.ts";
import { readApiKey } from "../stdin.ts";
import { authLoginPreview } from "./auth-login.ts";
import { credentialsCreate, credentialsDelete, credentialsList } from "./credentials.ts";
import { providersGet, providersList, providersUpdate } from "./providers.ts";

/** Answers one invocation without a runtime; the caller has already decided it belongs here. */
export function runtimeFreeCommand(
    command: string,
    input: CommandInput,
    dataDir: string,
): Promise<object> {
    const context = runtimeFreeContext(dataDir);
    switch (command) {
        case "providers list":
            return providersList(context)(input);
        case "providers get":
            return providersGet(context)(input);
        case "credentials list":
            return credentialsList(context)(input);
        case "credentials create":
            return credentialsCreate(context)(input);
        case "credentials delete":
            return credentialsDelete(context)(input);
        case "providers update":
            return providersUpdate(context)(input);
        case "auth login":
            return authLoginPreview(context, input);
        default:
            throw new CliError("INTERNAL", `pico ${command} has no runtime-free answer.`, {
                details: { command },
            });
    }
}

function runtimeFreeContext(dataDir: string): HandlerContext {
    return {
        dataDir,
        openCatalog: () => {
            throw new CliError(
                "INTERNAL",
                "A runtime-free command must not open the model catalog.",
                {
                    details: { dataDir },
                },
            );
        },
        openVault: options =>
            openCredentialVault({ dataDir, allowKeychainUI: options?.allowKeychainUI }),
        readStdin: () =>
            readApiKey({ isTerminal: process.stdin.isTTY === true, stream: Bun.stdin.stream() }),
    };
}
