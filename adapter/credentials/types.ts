/** What a Pico credential holds: a static API key, or an OAuth grant the SDK refreshes. */
export type CredentialKind = "api_key" | "oauth";

/**
 * Where a credential stands in its lifecycle. `deleting` is a row whose Keychain
 * item has not been removed yet; it is visible, never resolvable, and finished by
 * retrying the same deletion. Unpublished creations are not a state a caller sees.
 */
export type CredentialState = "active" | "deleting";

/**
 * The non-secret projection of one stored credential. It carries no SDK row id,
 * no Keychain payload and no token material, so a command can print it whole.
 */
export interface CredentialMetadata {
    reference: string;
    provider: string;
    kind: CredentialKind;
    state: CredentialState;
    email?: string;
    accountId?: string;
    orgId?: string;
    orgName?: string;
}
