---
id: proposal.0009
title: Pico Credentials and Provider Login
authors: [Mark Malstrom]
status: implemented
pull-request: https://github.com/markmals/pico/pull/47
issues: [https://github.com/markmals/pico/issues/12, https://github.com/markmals/pico/issues/7]
supersedes: []
---

# Pico Credentials and Provider Login

## Summary

Pico gains agent-first commands for provider discovery, Keychain-backed credentials, and provider login. An agent gives the human the SDK's authorization URL and observes completion. Pico uses explicitly selected credentials, independently of terminal OMP. This change adds no app UI and does not finish Autonomous support.

## Motivation

Pico can run models only by finding credentials outside Pico. Its adapter and model commands open OMP's credential store, and its startup errors direct the user to sign in with OMP. A user without an OMP installation has no Pico command for connecting a provider. A user with an OMP installation cannot choose independently which credentials Pico uses.

[Proposal 0007](0007-pico-owned-configuration.md) established Pico's versioned settings file, model defaults, and agent-first command contract. It deliberately deferred credentials to Beads `pico-bfk.4`, designed alongside the credential-store problem in [issue #7](https://github.com/markmals/pico/issues/7). [Issue #12](https://github.com/markmals/pico/issues/12) remains open for credential references and the real app configuration experience.

Mark selected the scope and direction for this proposal: credentials CLI only, no UI yet; Pico-owned Keychain storage rather than a plaintext SDK database; agent-only login, with the agent handing the authorization URL to the human; and credential-binding changes applying to all sessions on their next provider request. The app's Providers & Accounts pane stays unconnected. Connecting Models and the Settings file row remains Beads `pico-bfk.5`; connecting Providers & Accounts is separate Beads `pico-bfk.7`, dependent on this credential slice. This proposal alone cannot close #12.

## Domain grounding

### Established context

- **Provider, login method, and account are different concepts.** The [OMP provider documentation](https://omp.sh/docs/providers) distinguishes API providers from subscription providers. `openai` and `openai-codex` do not use interchangeable credentials. The installed SDK also has login-method aliases: `openai-codex-device` stores its result under `openai-codex`. Email alone does not identify a credential: the same email can have grants for different organizations.
- **Use the provider's implementation, not a second OAuth engine.** The [public SDK](https://omp.sh/docs/sdk) accepts explicit authentication storage and a registry using that same storage. In the installed `@oh-my-pi/pi-ai` 18.14.0, `AuthStorage.oauth.login(method, controller)` owns provider login and persistence; the controller receives authorization URLs, progress, prompts, and an abort signal. Public `getOAuthProviders()` and `PROVIDER_REGISTRY` supply method/provider discovery. `AuthStorage` accepts a public `AuthCredentialStore` implementation.
- **Device authorization is not always a URL alone.** [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html) distinguishes the verification URL, the user-facing code, and the private device code. Some SDK flows provide a complete verification URL; others provide a URL plus instructions containing the user code. The agent must relay the instructions too. The SDK owns polling, expiry, denial, and slow-down behavior.
- **Native-app authorization belongs in the external browser.** [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html) requires an external user-agent rather than an embedded credential-capturing webview. A loopback callback normally needs the browser on the machine running the login; a device flow can work from another device. A local `launchUrl` is not a remotely usable authorization URL.
- **A copied OAuth grant is not an independent login.** [RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14) describes refresh-token rotation and invalidation. Two stores refreshing copies can invalidate the grant. The installed SDK has refresh leases for processes sharing one store, not coordination between copied stores.
- **The current SDK has no read-only OMP-store reference.** `AuthStorage.create` opens a writable SQLite store. Construction does not populate the credential cache: callers must reload it. `credentials.reload()` can prune duplicate OAuth rows by deleting them (`auth/pool.ts:280-318,406-430`), so even a metadata-discovery caller cannot call it against OMP's store and claim to be read-only. The SDK's export/import path copies credentials; it is not a reference primitive.
- **Keychain access has an executable trust boundary.** Apple's [Keychain services](https://developer.apple.com/documentation/security/keychain-services) and [access-control documentation](https://developer.apple.com/documentation/security/access-control-lists) distinguish encrypted storage from permission to read it. An unsigned/ad-hoc executable, a replacement build, and a separately signed app cannot be assumed to share access. [`SecItemCopyMatching`](<https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)>) is synchronous and can block its calling thread.
- **Bun can reach Keychain, but API shapes matter.** [Bun's Secrets API](https://bun.com/docs/runtime/secrets) uses macOS Keychain and is asynchronous. Its `allowUnrestrictedAccess` option explicitly permits all apps to access an item and must not be used here. OMP's public `AuthCredentialStore` has synchronous update and compare-and-swap methods; an async write queued after those methods return is not durable persistence. Bun supports [.node Node-API addons](https://bun.com/docs/runtime/node-api); its [FFI documentation](https://bun.com/docs/runtime/ffi) explicitly recommends Node-API rather than experimental FFI for stable native integration.
- **Keychain does not solve current Autonomous support.** [Sesh's Autonomous documentation](https://sesh.codes/docs/approvals-and-autonomous/) says that agents other than Claude Code and Cursor cannot read Keychain. The local `seshd` reported 0.29.0 during research. This proposal does not change Sesh's policy or move all Pico state into its sandbox's writable directories.

### Repository observations and research probes

The pinned engine is `@oh-my-pi/pi-coding-agent` 18.14.0 and Bun is 1.4.4. `adapter/engine/credential-store.ts` opens the user's store through `discoverAuthStorage`; both session construction and CLI catalog construction use it. `runtime-storage.ts` already redirects the SDK's other runtime storage into Pico's data directory. `createPicoModelRegistry` already disables `models.yml` and accepts explicit authentication storage.

The current `pico --help` and `cli search` were exercised from source. They expose settings and model commands, not authentication commands. Discovery did not need credentials.

Two throwaway probes used fabricated credentials only:

- A public-SDK SQLite probe stored, reopened, resolved, and deleted a fake API key. The initial reopen found no credential until `credentials.reload()` was added; that matches the source's empty initial cache. The successful probe observed directory mode `0700` and database mode `0600`, but this is evidence about the rejected SQLite alternative, not the selected Keychain bridge.
- A Bun-compiled executable wrote a synthetic login-Keychain item, read it in a separate invocation, and deleted it in a third. It used default access controls, not unrestricted access. Every invocation exited 0, and a final lookup confirmed absence. The item and throwaway files were removed. This proves compiled Bun-to-Keychain access in the current user session; it does **not** prove the proposed synchronous SDK bridge, access after executable replacement, a locked Keychain, or Autonomous access.

No real OMP credential was read, imported, refreshed, or changed. No provider login or provider-backed request was performed during research.

### Relevant constraints and principles

- Secret material belongs in Keychain, never `settings.json`, SQLite credential rows, ordinary caches, project files, receipts, diagnostics, or journals. This includes API keys, OAuth access/refresh tokens, private device codes, cookies, authorization results, and PKCE verifiers.
- Login URLs and user-facing device instructions are the intentional, short-lived handoff to the human. They are not reusable provider credentials, but they still deserve sensitive handling. An agent forwarding them to a conversation exposes them to that conversation's retention; Pico cannot promise otherwise.
- OMP keeps its own credential lifecycle. Pico neither opens its store nor imports its grants in this design. Disconnecting Pico never calls a provider revocation endpoint or alters OMP.
- Keep the command registry authoritative. New commands inherit generated help, schemas, search, stable errors, previewable mutations, and noninteractive defaults. Login's streaming exception must be explicit in that registry.
- Persist a refreshed grant before returning it as usable. A successful provider exchange followed by a failed Keychain write is a failure, not a token usable only until this process exits.

### Quality bar

An unfamiliar agent can discover how to connect a provider, start login without opening a TUI, give the human the URL and instructions, observe a durable credential receipt, explicitly select it, and verify that a new Pico session uses it. Neither adding nor selecting a credential changes a model default. A missing, inaccessible, or rejected selected credential fails without using OMP, an environment key, or a sibling account instead.

### Remaining uncertainty

The complete SDK-to-Keychain adapter, cross-process refresh fencing, and access following a replaced/ad-hoc executable have not been exercised. They are implementation evidence gates below, not capabilities established by the Bun probe. Developer ID identity remains unavailable under the current unsigned distribution setup. Current Sesh policy is an explicit Autonomous limitation, not a hypothesis that this proposal promises to overcome.

## Existing baseline

Preserve proposal 0007's CLI registry, schema generation, search, JSON/error envelope, settings revision checks, atomic file writes, model/thinking defaults, and precedence of session-local model choices. Preserve SDK-owned OAuth/provider transport, model catalogs, and refresh behavior.

Replace the implicit opening of OMP's store in `adapter/engine/credential-store.ts` and `adapter/cli/commands/catalog.ts`. Every startup, catalog, restoration, and model-switch path must use the same Pico credential policy. Errors that currently say to sign in with OMP must instead point to discoverable Pico commands.

`adapter/native-addon.ts` and `tools/build-pico.ts` already carry and extract a native addon for a single-file executable. Reuse that packaging pattern for the Keychain bridge; do not make the installed executable depend on a development Bun, global OMP, Swift interpreter, or a separately installed helper.

The Mac app is not an authentication baseline. Its sample sign-ins are invented state, not authoritative provider capabilities or an account model to copy into the CLI.

## Proposed solution

Store each Pico credential in the user's login Keychain. Keep only credential IDs, provider identity, non-secret account metadata, lifecycle state, and refresh coordination in Pico's private metadata database. A versioned settings document references the credential selected for each provider. Credentials can exist without being selected; selecting one is an explicit, independently previewable operation.

Add provider discovery and credential-management commands. `pico auth login` is agent-driven: a finite process emits JSON Lines as the SDK asks the human to authorize and eventually reports success or failure. It opens no browser automatically, starts no OMP TUI, and runs no terminal prompt. The agent relays the provider URL and any user-facing code, then observes the command until completion. Ordinary commands still produce one JSON document.

```text
pico providers get openai-codex
    → provider, SDK login methods, and their supported interaction requirements
pico auth login openai-codex-device
    → authorization event with the SDK's URL and user instructions
human completes authorization in their browser
    → completion event with a non-secret Pico credential reference
pico providers update openai-codex --credential <reference> --dry-run
    → the proposed reference change, without saving
pico providers update openai-codex --credential <reference> --if-revision <revision>
    → the saved binding and new settings revision
pico models list --provider openai-codex
    → the real SDK catalog available through that selected credential
```

A saved credential is not proof that every provider request will work. Receipts say “stored” and “selected,” not “connected” or “verified,” unless the corresponding operation actually established that claim.

## Detailed design

### Concepts and identity

- **Model provider:** the SDK's provider ID used in model selectors. It is not a vendor display name.
- **Login method:** an SDK login ID, possibly different from its destination model provider. Preserve `storeCredentialsAs` instead of deriving the destination from a display name.
- **Pico credential:** one stored API key or OAuth grant, identified by an opaque, stable UUID assigned by Pico. OAuth refresh changes the grant's secret bytes, not that UUID. Provider-supplied account/organization metadata is descriptive, not the primary identity.
- **Credential reference:** the non-secret UUID and provider recorded in configuration. It is not a password, an array position, an email, or an SDK database row number.
- **Provider binding:** the explicit choice of at most one credential reference for a model provider. More credentials may be stored than are selected. Removing a binding and deleting a credential are different operations.
- **Login attempt:** one process-local, bounded SDK operation. Its verifier, private device code, temporary authorization result, and callback listener are not durable configuration.

This is the material ontology review: do not conflate a vendor with a provider, a login alias with its storage provider, an account label with grant identity, a stored credential with proven availability, or disconnect with revocation. SDK row IDs remain private implementation keys, mapped to Pico references. Do not add nicknames, account pools, or an independent connection-status state machine.

### Storage, synchronous bridge, and concurrency

1. On macOS, use Keychain generic-password items in service `me.malstrom.pico.credentials`, with the credential UUID as the item account. The item's versioned payload contains its UUID, provider, credential kind, and full SDK credential. Validate the payload on read and require its identity to match the metadata reference. Use the login Keychain, not iCloud synchronization or an assumed app access group.
2. Keep a versioned `credentials.db` under the existing Pico data directory. It holds the reference-to-SDK-row mapping, non-secret display metadata, active/deleting state, and durable refresh leases. Its directory is private (`0700`) and database private (`0600`). No credential payload, serialized refresh comparison operand, bearer fingerprint, or OAuth exchange state goes into this database or its WAL. SDK credential caches are real, expiring in-memory caches, not a second plaintext persistence path. Omit unsupported optional store capabilities rather than returning inert success.
3. Implement the public `AuthCredentialStore` contract with a small macOS Node-API addon calling the modern Security/CoreFoundation APIs synchronously. TypeScript owns SDK adaptation and configuration; native code owns Keychain calls, OSStatus translation, and CoreFoundation resource lifetimes. Do not use deprecated password APIs, experimental Bun FFI, a plaintext staging file, fire-and-forget writes, or a subprocess interface that prints credentials. The addon is embedded and extracted with the executable's existing native-asset pattern. Add its actual build task and pinned build inputs with the implementation; include third-party notices for any new build inputs.
4. The ordinary agent/ACP path must not trigger a Keychain authorization dialog or hang waiting for one: use the platform's fail-without-authentication-UI behavior. Authentication commands that read/write protected items may opt into the OS permission dialog with explicit `--allow-keychain-ui`, declared in their schema. This is a macOS permission dialog, not a new Pico UI. Never set unrestricted item access to avoid a prompt. Missing items, locked/unavailable Keychain, denied access, and malformed payloads remain distinguishable failures.
5. Serialize index/Keychain mutations across Pico processes with the metadata database's transaction/locking boundary. Refresh ownership uses durable, expiring per-credential leases and owner fencing; use the public SDK lease contract, not a process-local mutex. Never hold a metadata transaction over provider network I/O or a permission dialog. After obtaining a lease, reread the current Keychain payload before exchanging a token. A late writer must compare the expected credential and its lease ownership before replacing it; compare secret bytes in memory, not by persisting them in SQL. A process that loses ownership must not publish its stale result.

6. A new credential becomes visible only after its Keychain write succeeds. Allocate its identity as pending, write the item, then publish the active metadata row. Interrupted unpublished rows remain nonselectable and retain enough non-secret identity for bounded recovery on the next credential operation; cleanup targets only those Pico-owned items. A failed or superseded creation must compensate a Keychain write before forgetting its identity. If that deletion fails, retain a nonselectable deleting record so the same reference can finish cleanup. Refresh updates keep the same identity and persist the new Keychain payload before success. A crash after a Keychain replacement must not cause an older cached payload to overwrite that replacement after restart.
7. Deletion first makes a row nonselectable under the same lock, then deletes its exact Keychain item and finishes the metadata deletion. A failed Keychain deletion retains a deleting record and returns a failure naming the credential reference; retrying the same deletion finishes it. This is not success with an orphaned, forgotten secret. Ordinary lookups never reactivate a deleting row.
8. Do not open `~/.omp` to discover or migrate accounts. Do not copy provider secrets between runtimes, export a credential, or silently choose SQLite when Keychain is unavailable. On a platform without the macOS bridge, metadata/discovery commands still work and credential operations fail with a supported-platform prerequisite. There is no implicit libsecret/Windows-store backend in this proposal.

An exchange already in flight can rotate a grant after its credential is unselected. Persist that result under its original active reference with the same lease and byte fence; selection controls subsequent request use, not preservation of an already-issued grant. Unselection is not deletion.

### Configuration and selection

Extend the settings document to version 2 with an optional `providerCredentials` object mapping SDK model-provider IDs to Pico credential UUIDs. It contains no secret or Keychain access token. A missing map means no configured remote-provider bindings. Read version 1 as the same model/thinking defaults with an empty map; do not rewrite it merely by reading it. The first explicit settings mutation writes canonical version 2, preserving the existing default fields. Malformed or newer documents retain proposal 0007's visible refusal behavior.

`providers update` is the sole command changing this map. It accepts exactly one of `--credential <reference>` and `--disconnect`, plus `--if-revision` and `--dry-run`. A selection must name an active credential belonging to that provider. It must establish that the referenced Keychain payload is readable and valid before committing the reference; it does not claim that the provider accepts the grant. A failed or conflicting save leaves the last valid settings bytes intact. Repeating the current binding or disconnecting an already unbound provider is unchanged, not another write.

Disconnect removes the reference only. It neither deletes the Keychain item nor signs out at the provider. Deleting a credential that is still referenced in settings is refused with `FAILED_PRECONDITION`, naming the provider; disconnect or select another credential first. Settings and credential mutations coordinate so a selection cannot race deletion into a committed dangling reference. Manual Keychain removal remains possible and produces an unavailable-reference error when encountered, never another account selection.

Login and API-key creation store a credential but do not bind it automatically, change a model default, or change the reasoning level. Their receipts include the reference and the discoverable command for selecting it. API-key rotation can therefore create the replacement, select it, verify real use, and only then delete the old reference.

### Commands and output contract

All commands are declarations in the existing command registry. Help, schemas, search, input validation, output validation, error documentation, side effects, platform requirements, and streaming mode derive from those declarations. `--help`, `schema`, and `cli search` still require no credential, Keychain access, native-addon extraction, network, or writable home.

| Command | Behavior |
| --- | --- |
| `providers list` | List built-in model providers and SDK login methods, their destination provider, available Pico interaction capabilities, and configured reference metadata. No Keychain secret lookup or provider request. |
| `providers get <provider>` | The same information for one provider, including unsupported methods and their actual reason. Unknown IDs return `NOT_FOUND`. |
| `credentials list [--provider <provider>]` | List active/deleting Pico references, kinds, and SDK-supplied account/organization metadata. Listing stored metadata does not say that Keychain access or provider authentication works. |
| `credentials get <reference>` | Read one reference's metadata and validate its Keychain payload/access without exposing the payload. Permit explicit `--allow-keychain-ui`. No provider request or token refresh merely to inspect it. |
| `credentials create --provider <provider> --stdin` | Read one API key from non-terminal stdin and store it in Keychain. No argv key, interactive prompt, environment-variable expansion, command-valued secret, or chat-based secret collection. Permit `--dry-run` and explicit Keychain UI. |
| `credentials delete <reference>` | Delete exactly that unbound Pico credential. Permit `--dry-run` and explicit Keychain UI. Missing references return an unchanged receipt, making deletion retryable. Never revoke remotely. |
| `providers update <provider>` | Save or remove the provider binding as specified above. Permit explicit Keychain UI for validating a new binding. Return proposal 0007-style before/after, revision, `changed`, and `dryRun`. |
| `auth login <method>` | Run one agent-driven SDK login, emitting the event stream below. Permit `--dry-run` and explicit Keychain UI. No browser launch or terminal UI. |

Ordinary success documents and error documents retain `apiVersion: 1`, JSON stdout, coded stderr, and the established exit-status rules: `INVALID_ARGUMENT` exits 2; other failures exit 1. Extend stable error codes only where a caller must distinguish a new condition: `AUTH_REQUIRED`, `KEYCHAIN_LOCKED`, `KEYCHAIN_ACCESS_DENIED`, `CANCELLED`, and `TIMED_OUT`. Use `FAILED_PRECONDITION` for unsupported interactions/platforms and `CONFLICT` for stale configuration or a superseded credential mutation. Keep OSStatus and safe provider error categories in details; do not include raw HTTP response bodies, credential objects, or callback URLs in an exception message.

For API-key stdin, remove one trailing line ending, not arbitrary internal whitespace; reject terminal stdin, missing/empty input, invalid UTF-8, NUL, or input over 64 KiB. Report “stored, not provider-verified” after persistence. Only offer this operation for SDK model providers accepting a static API key, not cloud identity chains that require other configuration. Source that capability from the public provider/catalog definitions; do not infer it from a provider's familiar name.

Mutating commands support `--dry-run`. A preview validates input and reports the intended target/effects without creating directories, extracting a native addon, touching Keychain, starting OAuth, making provider requests, or changing settings. An OAuth preview reports a planned login, never fabricated authorization/completion. A credential-reference preview can establish metadata compatibility but must explicitly say that Keychain access was not checked. No receipt includes a secret, a token prefix, or a raw SDK credential snapshot: SDK snapshots can still contain access material, so output is an explicit metadata projection.

Credential deletion and creation do not reuse the settings-file revision as if it versioned Keychain. Expose an opaque metadata revision and `--if-revision` for their index mutation; a dry run returns the current index revision, not an invented future secret revision. Login carries its starting metadata revision and fails visibly if a conflicting update would overwrite an existing grant. Token refresh alone does not change the settings-file revision or represent a new user selection.

### Agent-only login lifecycle

`auth login` advertises `json-lines` output in its command schema; it is the sole streaming exception to the ordinary one-document success rule. With `--dry-run`, it returns a single preview document instead. Every event carries `apiVersion: 1`, a process-local `attemptId`, a monotonically increasing sequence, and a `type` discriminator. Flush complete lines promptly. The event types are:

- `started`: the login method, its destination provider, and the SDK authorization deadline;
- `authorization`: the SDK's full external `url`, safe optional `launchUrl`, and user-facing instructions, preserved without truncation; identify when a callback requires a browser on the same machine;
- `progress`: sanitized SDK progress, never request/response dumps;
- `completed`: the durable credential reference and non-secret identity metadata, with `stored: true` and the next selection command;
- `failed`: the same safe coded error shape written as the final stderr error document.

One terminal event is emitted, then the process exits. A streamed failure may follow already-emitted events on stdout; the registry and guide document that exception rather than promising empty stdout on every failure. The final stderr error and nonzero exit remain authoritative if the pipe closes before the terminal event.

Login reads no answers from stdin. The agent supervises the process, relays its authorization event to the human, and waits for the SDK's browser callback or device polling to complete. Closing stdin is not cancellation. The SDK authorization phase is bounded by its signal, output pipe, and deadline; an explicitly permitted synchronous macOS permission dialog has the separate behavior below.

Supply the SDK callbacks directly. Do not call the OMP terminal-login frontend. Do not automatically open the URL: the agent passes it and any user-facing device code/instructions to the human. Emit the external authorization URL even when the SDK also supplies a shorter loopback launch URL, so an agent can explain the device/same-machine distinction accurately. Do not manufacture a complete verification URL when the SDK supplies only a URL and code. Choosing another SDK method, such as the Codex device method, is explicit, not a hidden fallback.

The local browser return page identifies Pico and carries no OMP name or mark. A received callback is not a durable credential receipt: the page directs the human back to the agent while sign-in and Keychain persistence finish. The pinned SDK hardcodes this HTML and exposes no host-branding option; the smallest upstream seam would be a host-supplied page template. For this release, a version-pinned, HTML-only Bun package patch changes the presentation while keeping SDK authentication exports, callback validation and token exchange untouched. Verify the served source and compiled pages rather than pinning their wording in source-text tests.

Run the SDK login against an isolated, real in-memory credential store, then commit its newly issued result to the Keychain-backed vault. The SDK's normal OAuth-login path removes sibling API-key rows for the same provider; it must not perform that provider-wide mutation on Pico's authoritative vault. Staging preserves SDK-owned login enrichment and destination-provider mapping without deleting other Pico credentials or publishing an incomplete login. No secret staging file is written.

This interface supports SDK browser/device flows that complete through authorization URLs without further input. Reject every prompt and browser-session callback. For SDK-declared browser-callback methods, suppress manual input with a callback that supplies no answer and settles only when the SDK's callback-wait signal ends. The public SDK facade can synthesize a paste prompt when the callback is absent, while rejecting that parallel fallback cancels valid browser login; neither omission nor immediate rejection expresses this URL-only policy. For methods with undeclared interaction requirements, supply a rejecting manual-code callback. Do not classify a prompt as safe merely because the SDK's optional `secret` flag is absent. Passwords, one-time codes, API keys, pasted OAuth callback URLs, browser cookies, and non-secret terminal choices are not collected by login. API keys use the separate private-stdin command. Methods known to require input are listed as unsupported before starting: this includes the pinned SDK's GitHub Copilot login, which always asks for an Enterprise domain, and methods marked paste-code-only. For custom flows with undeclared interaction requirements, an unexpected callback aborts with `FAILED_PRECONDITION` and no successful credential receipt, even if the flow catches the callback's rejection. Expose SDK methods and Pico compatibility separately; do not claim every SDK login entry is usable. Adding machine answers or provider-specific prompt defaults is later work, not an implicit exception to URL-only login.

The process holds the SDK flow in memory and keeps its callback listener only for that attempt. It starts no always-on service and writes no resumable OAuth-flow file. The SDK authorization phase has a ten-minute deadline; earlier provider or SDK callback expiry wins. SIGINT, SIGTERM, a broken output pipe, or that deadline aborts the SDK signal and releases the attempt's listeners. After authorization, the synchronous Keychain commit is outside the authorization deadline. An explicit `--allow-keychain-ui` permission dialog can therefore wait for a local response; dismiss that macOS dialog to cancel a blocked native call, since JavaScript signals cannot interrupt it. Cancellation observed before the durable credential commit publishes no credential; a completed commit is not revoked or silently deleted because the caller disconnects afterward. No automatic login retry occurs. If completion output is lost, the caller inspects `credentials list` rather than assuming no credential was stored.

### Catalog, session, and restoration behavior

Pass explicit Pico authentication storage and its matching registry into the SDK in every path. Preserve isolated settings, Pico-owned SDK directories, disabled OMP discovery, and host-provided MCP configuration. Replace the old implicit OMP-store construction and its OMP-login recovery text completely; do not leave a legacy fallback or import path.

Remote-provider availability and request credentials come only from explicitly configured Pico references. Filter catalog discovery and credential resolution at the policy boundary: a provider environment variable, native cloud credential chain, unselected stored grant, broker environment variable, or SDK default-store discovery must not authorize an unconfigured provider behind the binding. A selected credential that fails must not fall through the SDK's normal sibling/environment cascade. Keep genuine keyless local model discovery working. Non-auth OMP environment settings remain outside this change, as in proposal 0007.

Use public SDK credential and exact-account resolution hooks so OAuth identity headers, refresh, and provider transport remain SDK-owned. A provider's login alias resolves to its actual model provider before binding validation. Listing credentials does not refresh them; an actual model credential resolution can refresh the selected grant and must persist it to Keychain through the fenced store before use.

Provider bindings are global, not session choices. Mark chose that every session, including an existing or reopened one, uses the latest saved binding on its next provider request. Resolve that binding and its current Keychain payload at each authenticated request boundary, including subsequent model-loop/compaction requests within a turn, rather than capturing it in the session's initial registry or a stale credential cache. A binding change needs no adapter restart. An already-dispatched request keeps the credential it was issued with; the next request resolves the current binding. Removing a binding or losing access to its selected item fails the next resolution without substituting another account.

Do not journal a credential selection or add a credential-reference migration to session history. Reopened sessions, including older journals, use current global bindings while keeping their own journaled model and reasoning level. An invalid or unsupported current settings file prevents resolving its credential bindings and fails visibly; it does not authorize a last-known binding. Changing the global credential never changes the session's model or thinking choice, and it never switches an unavailable saved model to a different one.

### Tests, guide, and implementation evidence

Write behavioral tests before production changes and extend the guide from this proposal before implementing commands. Use existing colocated Bun tests, registry/parser/schema tests, session fixtures, and compiled `pico:verify` patterns. The important boundaries are:

- **Credential privacy and ownership:** fake credentials persist through the real Keychain adapter, are never present in metadata DB/WAL/settings/journals/receipts/errors, and never cause access to a scratch OMP store. Discovery works without Keychain or a writable home. OMP sentinels stay unchanged.
- **Storage transitions and concurrency:** denied/missing/locked items, failed Keychain writes/deletes, interrupted creation/deletion, stale index revisions, simultaneous writers, refresh lease loss, process termination after token rotation, and restart never publish success before persistence or overwrite a newer grant. Use local fake provider responses and subprocesses; do not race live rotating grants for a test.
- **Agent login:** a local fake provider driven by the real SDK exercises URL/instructions, success, denial, cancellation before commit, timeout, broken pipe, unsupported prompt/manual/browser callbacks, and destination-provider aliases. Completing OAuth does not delete an already-stored API key or change its selection. The compiled process actually flushes events through its output pipe, with stdin closed, no terminal, and no automatic browser launch.
- **Selection and sessions:** creating a credential alone authorizes nothing; selection authorizes only its provider/reference; failed selection preserves settings bytes; disconnect does not delete or revoke; referenced deletion is refused; stale/locked selected credentials never use an environment key or sibling account. Change the binding while a session is open and verify its next provider request, including a later request in the same turn, uses the new reference without a restart. A request already in flight remains unchanged. New, switched-model, and reopened sessions, including an older journal, use current global credentials without changing their model/thinking choices. Test version-1 settings adoption without introducing credential fields into history.

Add a macOS integration task that uses a uniquely named synthetic Keychain service, never the production service or a real user account. Prove synchronous SDK writes and refresh persistence, process restart, and separate compiled-binary invocations with no Bun on PATH. Prove access and failure/recovery across an executable replacement without granting unrestricted ACLs. Cover both the development launcher and packaged executable's item access; do not require the app to share the item's trust. Delete every synthetic item after the run and report cleanup failures.

Extend the offline compiled smoke to use the new credential policy without real secrets. Keep keyless local discovery as its baseline and exercise API-key storage/selection through a local fake endpoint only where the public SDK supports that route. Do not ship a fake provider or add one to the user's registry to make the smoke pass. Use a macOS Keychain integration scenario for the actual credential path rather than claiming a keyless turn proved it.

The real preview must use the compiled executable for a supported browser/device login and a provider-backed Sesh prompt on the selected credential. A real login, provider request, or OS permission dialog needs the human's participation/authorization; the implementation report names anything not exercised. Observe the actual Sesh/ACP tool output for agent-driven login, not just a hand-parsed pipe transcript. Keep credentials and authorization results out of screenshots and readiness reports.

Update `guides/running-pico-in-sesh.md` for independent Pico setup, the URL/device handoff, secret stdin, select/disconnect/delete distinctions, Keychain recovery, and the unchanged Autonomous limitation. Update the repository contract, README, brief, and vision only where they describe implicit OMP credential reuse or the absence of these CLI capabilities. The app remains a scaffold. Add the implementation changeset and relevant platform build/integration tasks. Run `mise run check`, `mise run pico:verify`, the new macOS Keychain integration task, and the real preview before claiming implementation complete.

## Compatibility

- **Deliberate credential cutover:** Pico stops automatically reusing OMP accounts and broker configuration. Existing users must connect credentials in Pico and explicitly select them. No automatic import, token copying, OMP account enumeration, or shared-refresh arrangement remains. OMP itself is unchanged.
- **Keychain is required for managed credentials on macOS.** A denied or unavailable Keychain is an error, not permission to create a plaintext store. The app does not acquire credential access. Linux/Windows do not gain a managed-secret backend; credential-dependent paths report the platform prerequisite while discovery and genuinely keyless paths remain usable.
- **Settings evolve; credential history does not:** version-1 settings are read without mutation and upgraded only on an explicit save. New, existing, and reopened sessions use current global credential bindings on their next request, while model and reasoning choices remain session-local. No credential reference is added to a journal. Unsupported newer settings remain visibly refused.
- **CLI compatibility:** ordinary JSON commands, error exit conventions, ACP stdio, bare invocation, and `--version` keep their existing behavior. Only `auth login` explicitly declares bounded streaming output. Existing commands expose the added non-secret reference configuration through their authoritative schemas.
- **No app, installation, registration, signing, or release change:** the executable still carries what it needs. Adding an embedded native bridge changes build inputs, not the user's setup prerequisites. App distribution and Developer ID signing remain separate.

## Implications on adoption

An agent can configure Pico without a global OMP installation or terminal UI, but it cannot complete the human's provider approval for them. API keys must come from a private stdin source, not a chat message. Browser loopback authorization may require the human at the machine running Pico; offer an SDK device alternative when one exists.

Keychain can require a local OS access decision, especially after an unsigned executable changes. The commands must expose that prerequisite and permit explicit authorization without weakening ACLs. Current Autonomous sessions cannot use these credentials under Sesh's documented policy. Mark chose that tradeoff over unencrypted SDK storage.

Disconnecting provider bindings is reversible while credentials remain. Deleting a credential removes only Pico's local material, not the provider grant. Removing settings or downgrading to an older Pico does not delete Keychain items. An older version may resume its historical implicit OMP behavior; it must not be presented as a credential migration or a safe way to preserve Pico's new account-selection policy.

## Scope

- Agent-first provider/method discovery, private API-key entry, agent-driven OAuth/device login, credential inspection/deletion, and explicit provider bindings.
- Keychain-backed public SDK storage, synchronous native bridge packaging, non-secret index, durable refresh coordination, and truthful access failures.
- Configuration, catalog, request, session, and restoration integration that makes the selected credential real and removes implicit OMP credential use.
- Behavioral tests, compiled/macOS evidence, agent/Sesh preview, guide, affected current-capability descriptions, and a changeset.

### Out of scope

- All Mac app UI, including Providers & Accounts, Models, Settings file row, and sample-data removal. No GUI flow or prototype GUI acceptance criterion is claimed.
- Closing #12. Its app-facing acceptance remains outstanding after these commands exist.
- Closing #7, changing Sesh's sandbox/Keychain rules, moving all runtime state, or claiming Autonomous compatibility.
- Safe OMP reuse/import, a shared auth broker, credential export, browser-cookie extraction, manual OAuth-result collection, terminal login, or an always-on local service.
- Account pools, failover between accounts, per-project credentials, nicknames, quotas/prices, provider revocation, custom provider definitions, or new provider implementations.
- App packaging, signing/notarization, Homebrew publication, Sesh registration changes, or changes to the curated execution/delegation policy.

## Preview

- Repository shape: local CLI/ACP executable; no desktop UI changes.
- Artifact: this checkout's `.build/pico`, carrying the Keychain bridge, plus the development launcher for comparison. Nothing is installed over the Homebrew executable or registered differently without permission.
- Access: local/private checkout and the already supported Sesh agent path. No hosted endpoint, deployment, public token, or separate daemon.
- Exercise: an unfamiliar agent discovers login from the executable, starts the finite process, gives the human the actual authorization URL/instructions, observes a credential receipt, previews/selects its reference, and reads back provider/model state. A new Sesh session answers using it. Inspect that an existing session retains its explicit model/thinking choices and the confirmed credential-binding behavior. Disconnect the reference, observe absence without fallback, and reconnect it without changing terminal OMP. Separately run synthetic denial/concurrency/restart/replaced-executable scenarios without exposing real secrets.
- Completion cleanup: stop unfinished login processes/listeners, delete synthetic Keychain items and scratch metadata/build probes, and leave only credentials/bindings the human explicitly wants to keep. Do not sign OMP out or revoke provider grants as cleanup.

## Policies and decisions checked

- Formal policy records: None; `policies/` contains only its index.
- Formal decision records: None; `decisions/` contains only its index.
- [VISION.md](../VISION.md): keep native, truthful configuration and agent-discoverable settings; the eventual GUI remains a goal, not something this CLI slice claims to deliver. Its current description of automatic credential reuse must change when this implementation lands.
- [PROTOTYPE.md](../PROTOTYPE.md#configuration-and-credentials): keep secrets out of ordinary preferences, use public SDK authentication/catalog APIs, and prove helper storage access. Mark's selected independent-Keychain direction deliberately does not implement its planned explicit OMP reuse or GUI flow in this slice; those criteria remain outstanding rather than being marked complete.
- [Proposal 0007](0007-pico-owned-configuration.md): preserve settings ownership and model/thinking precedence. This proposal extends its configuration with references, replaces its temporary implicit credential reuse, and explicitly adds bounded streaming output for authentication only. It does not relax noninteractive defaults for other commands.
- `AGENTS.md`: preserve no silent fallback, no global OMP changes, no second provider engine, no invented capabilities, and the single-file runtime contract. No policy/decision record is added: these are feature choices discussed with Mark, not a new repository-wide rule.

## Future directions

- A later Providers & Accounts UI (Beads `pico-bfk.7`) can consume these commands after deciding how it supervises the event stream and presents Keychain prerequisites. The existing sample pages do not settle that design.
- Safe explicit OMP reuse requires a suitable owner-mediated/public SDK capability or a revised, human-approved sharing model; copying rotating grants is not an implementation shortcut.
- Autonomous support requires a compatible host access boundary plus proof about all runtime state, not another credential copy or a silent plaintext fallback.

## Alternatives considered

- **Public SDK SQLite store:** a scratch round trip works with private filesystem modes and the SDK's existing leases. It is simpler and more aligned with current Autonomous access, but unencrypted at rest. Mark selected Keychain instead.
- **Keep using the shared OMP store or import its OAuth grants:** this preserves initial convenience but cannot provide independent ownership. Writable opens/reloads and refresh mutate OMP; copied rotating grants can invalidate it. Rejected for the selected independent-login design.
- **Bun.secrets with delayed SDK writes, experimental FFI, or a secret-printing helper:** the compiled Secrets API probe establishes native access, but queued async persistence cannot satisfy synchronous SDK commits. Experimental FFI is not the recommended stable bridge, and a credential-printing subprocess expands the leakage surface. Use a narrowly scoped Node-API bridge instead.
- **Interactive terminal login or a native sign-in UI now:** Mark selected agent-only URL handoff and no UI. Neither a TUI launched behind the scenes nor sample app state meets that direction.
- **A detached login daemon with on-disk resumable OAuth state:** it could make each CLI call short-lived, but adds sensitive flow persistence, lifecycle/recovery, and a service boundary the SDK does not need. A supervised finite login process keeps state in memory and cancellation tied to its caller.

## Acceptance and delivery

Mark accepted this implementation on 2026-11-04: “LGTM, this is ready to merge. Please clean up afterwards.” The accepted scope and observed verification are recorded in the [readiness report](https://github.com/markmals/pico/pull/47#issuecomment-6621051740). No implementation or design revisions were requested.

This status records accepted implementation in the original feature pull request before merge into `main`. Delivery for this change is merge-only: no release, Homebrew publication, signing, or notarization was requested or performed. GitHub #12 remains open for real app configuration and #7 for Autonomous support; Beads `pico-bfk.4` is complete.

## Open questions

None. Mark approved implementation on 2026-11-03. During implementation they clarified two SDK/native boundaries: suppress the optional pasted-code fallback for declared browser-callback methods while rejecting unexpected manual input from undeclared flows; bound SDK authorization to ten minutes while allowing an explicitly permitted macOS permission dialog to finish outside that deadline. The first live Anthropic attempt exposed that omission lets the public SDK synthesize a paste prompt, so the no-input policy requires an explicit non-answering callback rather than omission. Native storage, replacement-access, and real-provider checks remain implementation evidence requirements.
