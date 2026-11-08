import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent";

import type { CredentialVault } from "../../credentials/vault.ts";
import type { CommandHandler } from "../execute.ts";

import {
    credentialsCreate,
    credentialsDelete,
    credentialsGet,
    credentialsList,
} from "./credentials.ts";
import { modelsGet, modelsList } from "./models.ts";
import { providersGet, providersList, providersUpdate } from "./providers.ts";
import { settingsGet } from "./settings-get.ts";
import { settingsUpdate } from "./settings-update.ts";
import { versionGet } from "./version.ts";

export type HandledCommand =
    | "models list"
    | "models get"
    | "settings get"
    | "settings update"
    | "providers list"
    | "providers get"
    | "providers update"
    | "credentials list"
    | "credentials get"
    | "credentials create"
    | "credentials delete"
    | "version get";

export type CommandHandlers = Record<HandledCommand, CommandHandler>;

/** The catalog a command reads: Pico's model registry over the credentials it has selected. */
export interface OpenedCatalog {
    registry: ModelRegistry;
    /** The provider bindings the registry was built from, reported as the result's context. */
    providerCredentials: Record<string, string>;
}

export interface HandlerContext {
    dataDir: string;
    openCatalog(): Promise<OpenedCatalog>;
    /**
     * Pico's credential index and its Keychain items. `allowKeychainUI` is the caller's explicit
     * `--allow-keychain-ui`, which lets macOS ask the human about an item instead of failing.
     */
    openVault(options?: { allowKeychainUI?: boolean }): CredentialVault;
    /** One API key, read privately from a non-terminal stdin. */
    readStdin(): Promise<string>;
}

/** The commands that need Oh My Pi, bound to one data directory and catalog. */
export function createCommandHandlers(context: HandlerContext): CommandHandlers {
    return {
        "models list": modelsList(context),
        "models get": modelsGet(context),
        "settings get": settingsGet(context),
        "settings update": settingsUpdate(context),
        "providers list": providersList(context),
        "providers get": providersGet(context),
        "providers update": providersUpdate(context),
        "credentials list": credentialsList(context),
        "credentials get": credentialsGet(context),
        "credentials create": credentialsCreate(context),
        "credentials delete": credentialsDelete(context),
        "version get": versionGet(),
    };
}
