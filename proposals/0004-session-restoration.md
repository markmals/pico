---
id: proposal.0004
title: Persistent Pico Sessions
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/40
issues: [https://github.com/markmals/pico/issues/5]
supersedes: []
---

# Persistent Pico Sessions

## Summary

Persist Pico's private agent-continuation state under `~/Library/Application Support/Pico`, using OMP's journal format. Implement ACP resume, load and list so a client can continue the correct context after restart, with optional history replay. Sesh remains the conversation UI; Pico stores no second client-facing session system.

## Motivation

A Sesh user cannot continue a Pico conversation after Sesh restarts the adapter. Pico creates an in-memory engine session, assigns an unrelated ACP identifier, and has no durable association between them. Starting another session loses the earlier engine context even when Sesh still displays the conversation.

Sesh owns the user-facing conversation and workspace. Its [custom-agent documentation](https://sesh.codes/docs/more-agents/) says that removing an agent leaves its sessions' history intact. Pico's journal is private agent-continuation state, not a replacement for that client-owned history or a second session UI.

ACP is stateful: `session/prompt` supplies the new prompt and an agent session ID, not the entire conversation. A resume request also carries no history back to the agent. The client retaining a transcript therefore does not, by itself, recover an exited engine's messages, tool results and compaction state. Avoiding agent persistence would require a separate full-context transfer contract; Pico has none.

[Issue #5](https://github.com/markmals/pico/issues/5), tracked as `pico-rrn`, requests the missing restoration path. [Prototype criterion 10](../PROTOTYPE.md#prototype-acceptance-criteria) requires stopping the adapter, reopening the conversation, continuing with its context, checking replay for duplication and stale tool statuses, and verifying disconnect cleanup. Proposal 0001 deliberately deferred persistent identity and its ontology review to this work.

## Domain grounding

### Established context

- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup) distinguishes `session/load`, which replays the entire conversation through `session/update` before answering, from `session/resume`, which restores context without replay. These are different client needs, not aliases.
- Client-owned transcript retention and agent-side continuation are separate responsibilities. ACP resume sends an identifier and attachment parameters, not a conversation to rehydrate; load asks the agent to send history in the opposite direction.
- The installed `@agentclientprotocol/sdk` 2.1.0 default entrypoint exposes both methods and `session/list` in stable ACP v1. `loadSession` advertises loading; `sessionCapabilities.list` and `.resume` advertise the other methods through present object markers. The installed stable declarations and schemas govern this proposal; experimental ACP v2 behavior does not.
- `session/list` accepts an optional absolute `cwd` filter and opaque cursor, and returns session identifiers, working directories, optional titles and update times, and an optional continuation cursor. A resume request can omit `mcpServers`; omission means an empty list, not permission to recover an old server configuration.
- The [OMP public SDK](https://omp.sh/docs/sdk) accepts an explicitly supplied `SessionManager`. The installed `@oh-my-pi/pi-coding-agent` 18.14.0 exports file-backed creation/opening, stable session identifiers, flushing, custom journal entries, and branch-aware history reconstruction. Its public subpath exports include directory, storage, listing, and interrupted-turn helpers.
- OMP model context is not the display transcript. `buildSessionContext()` folds compaction into the context used for inference; `{ transcript: true }` preserves the selected path's older conversation. Neither raw file order nor the compacted context is a correct full-history replay source.

### Relevant constraints and principles

- **Location, not a new history format.** During proposal development, Mark selected separate storage only: Pico owns its history location but continues using OMP's journal format. An engine-independent conversation format is not part of this change.
- **Configuration sources and runtime storage are different responsibilities.** An explicit session directory does not relocate every SDK side effect: installed `session-manager.ts` constructs its blob store from `getBlobsDir()`, title changes can update `history.db`, and terminal breadcrumbs can register custom session paths. Merely changing `SessionManager.inMemory()` to `.create(cwd, directory)` is insufficient isolation.
- **Identity outlives attachment.** An ACP conversation persists while its live engine object, event listeners, MCP connections, and transport are repeatedly created and released. A process, working directory, title, or filename is not a second conversation identity.
- **A tool result is not a second tool call.** An assistant's tool-call content and its corresponding result describe one invocation, identified by its original `toolCallId`. A crashed operation's outcome can be unknown even when its replay card must no longer say it is running.
- **Storage acknowledgments matter.** SDK append calls do not by themselves report every persistence failure to their caller. Pico must observe persistence errors and await a flush before claiming a durable operation succeeded. Streaming a chunk does not establish that a whole message is durable.
- **Current policy wins over saved runtime configuration.** Restore conversation context, not old tool admission or MCP credentials. The current Pico roster and the restoration request's MCP servers govern a reopened session.

### Quality bar

A restored conversation has the same stable identity and correct saved context; loading shows each retained message and invocation once, and resuming adds no old transcript. Pico history, artifacts, blobs, and history metadata stay in Pico-owned storage. An unavailable model, invalid archive, contested session, failed server, or failed save is visible rather than replaced by a new conversation, another model, a silent fork, or an in-memory success.

### Remaining uncertainty

Sesh's public documentation promises session recovery but does not specify whether it uses `session/load`, `session/resume`, or `session/list` for a custom agent. That calling pattern must be observed during implementation, not inferred from ACP support. Persistence and restoration solve restart continuity; list and load are optional client capabilities, not prerequisites merely because Sesh has sessions. All three remain specified because issue #5 requests them. This proposal introduces neither a standalone Pico session workflow nor a second client archive.

Two disposable public-API probes establish feasibility, not adapter completion:

- Separate create/open processes preserved the same session UUID. After a branch change and compaction, the model context contained a summary and the retained tail; transcript mode retained the earlier user message, assistant messages, tool invocation and result, excluded the abandoned branch, and listed the saved session.
- A scratch process captured the original OMP configuration directory, called public `setAgentDir()` with a Pico-owned engine directory, and explicitly loaded settings from the original directory. It persisted and reopened an OMP-format session, title, and blob under Application Support. The selected setting remained `original/model`; the original agent directory contained only its original `config.yml` after both processes. This did not exercise credential refresh, complete extension discovery, a model-backed restored turn, or Sesh.

The implementation must prove those remaining boundaries with the actual adapter and compiled executable. No restoration capability is claimed by these probes.

## Existing baseline

[Proposal 0001](0001-acp-adapter-core.md) supplies the working turn path and cancellation behavior. `adapter/server/pico-agent.ts` keeps live runtimes in a connection-local map, assigns `randomUUID()` after engine creation, advertises `loadSession: false`, and registers no load, list, or resume handler. `adapter/engine/pico-session.ts` supplies `SessionManager.inMemory(cwd)` to the SDK. Preserve the existing session construction, error propagation, ordered updates, bounded cancellation, and disposal ownership rather than starting another adapter.

`adapter/events/session-event-mapper.ts` already opens a tool call once and settles it once during a live turn. It consumes `WriteBridge` records that are not retained after the turn. Preserve their accurate file changes and terminal statuses; rebuilding a historical diff from today's filesystem would invent evidence.

[Proposal 0002](0002-pico-homebrew-distribution.md) establishes Pico's private Application Support directory, native-addon extraction, and model-cache location. Preserve that root and the user's existing configuration and credential sources. Its rejection of moving all configuration reads to a new `agentDir` still applies: this proposal separates explicit configuration reads from the SDK's process-local runtime storage instead.

[Proposal 0003](0003-pico-only-child-sessions.md) constrains admitted Sesh child launches to the parent's registered Pico agent. Reopening a conversation must retain that adaptation and all existing roster restrictions.

OMP's own ACP implementation is comparative evidence, not the implementation to copy unchanged. Its global history lookup can expose unrelated terminal sessions, and its default replay source is the compacted model context. Pico needs its own scoped discovery and full-transcript projection.

## Proposed solution

Store OMP-format journals in Pico's Application Support directory and use each journal's stable engine UUID as its ACP session identifier. Keep only the live attachment in memory. Reconstruct every attachment through the same Pico factory, then either replay its saved conversation or return without history, according to the ACP method.

```text
new conversation → durable Pico-owned journal → return its stable sessionId
adapter stops → attachment disappears; journal remains
session/load(sessionId) → reconstruct policy and context → replay history → ready
session/resume(sessionId) → reconstruct policy and context → ready, no replay
session/list → discover only Pico-owned journals
```

Keep a small amount of Pico-owned replay metadata in public SDK custom entries within the same journal for presentation facts that engine messages do not retain, particularly captured write diffs. Do not introduce a second conversation log, database, or engine-independent history format.

### Ontology review

**Assessment: coherent.** The durable conversation, its live attachment, and its history projections have different lifetimes and must not be conflated.

- **Concept inventory:** Sesh's client-owned session is distinct from Pico's agent-side continuation, which is identified by the persistent ACP/engine UUID. The client retains the agent-returned ID for restoration; Pico does not infer it from Sesh's own session identifiers. An attachment owns one live engine and transport-facing resources, and a tool invocation has its original call ID within that continuation. A working directory supplies project context but does not define identity.
- **Conflations resolved:** model context is a compacted inference projection, not the full display transcript. An unresolved tool outcome is not a still-running operation after its process exits. MCP connection credentials belong to an attachment, not its durable conversation.
- **False distinction removed:** Pico's current random ACP ID and engine ID do not represent different conversations. Reuse the persistent engine UUID instead of maintaining two identities and a mapping index.
- **Ownership boundary:** the journal is authoritative for saved engine context and the supported ACP replay source, not for Sesh's client-owned conversation record. Pico presentation entries preserve otherwise-lost display evidence; directory buckets, titles, indices and filenames are representations or derived metadata, not independent authorities.

## Detailed design

### Durable ownership and identity

Use `~/Library/Application Support/Pico/sessions/` as the session root, with deterministic per-working-directory buckets. Use `~/Library/Application Support/Pico/engine/` for SDK-owned history support, including blobs and optional history indices. Artifacts remain beside their journals inside the session root. Newly created history is private to the user; an inaccessible or unwritable location fails visibly. Do not fall back to OMP history or temporary storage.

At process bootstrap, resolve and retain the user's original OMP configuration directory before redirecting the public SDK directory resolver to Pico's engine directory. Pass the original directory explicitly wherever configuration, model definitions, credentials, extensions, skills, or rules are read. Continue using the original credential store in place; no credential copy or new provider configuration is introduced. Apply the runtime-storage override once per process, never as a mutable per-session switch. Audit subprocess environment and discovery paths so the override neither changes the configured engine/model sources nor reintroduces excluded tools. Do not rewrite the user's configuration or terminal-session breadcrumbs.

This separates conversation storage, not every OMP filesystem write. The public directory probe confirms that SDK ownership leases still resolve through `getSessionOwnersDir()` to `~/.omp/run/session-owners`; they contain runtime lock state, not archived conversation content. Retain the public lease mechanism and existing credential behavior rather than claiming complete OMP filesystem independence or adding a second locking implementation.

Create a new persistent manager through public APIs with an explicit Pico session bucket. The public `SessionManager.inMemory(cwd).persistCopy({ sessionDir, suppressBreadcrumb: true })` route provides a materialized empty journal without registering a custom session path in terminal OMP history. Open existing journals with an explicit bucket, `suppressBreadcrumb: true`, and `throwIfMissing: true`. Do not patch SDK internals or use its missing-file behavior to create a replacement session.

Return the persistent manager's `getSessionId()` as the ACP `sessionId`. There is one durable agent identity, not two identifiers requiring a separate mapping database; this does not replace Sesh's client-side session identity. A journal keeps its identity across restart; `session/new` always creates a different identity, even for the same working directory. Validate identifiers before lookup, resolve only beneath the Pico session root, reject symlink escapes and duplicate identities, and require the requested identifier to match the loaded header. A client-supplied identifier is never an arbitrary file path.

Before answering `session/new`, finish normal model, credential, MCP and roster validation and flush the new journal. A returned identifier is therefore reopenable even before the first prompt. An attachment that fails startup is disposed and not registered as live; it does not receive a successful ACP response. After its writer closes, remove only the newly created, never-returned journal and its owned artifacts so a failed creation does not appear as a saved conversation. Failed restoration never deletes the existing journal.

Subscribe to the manager's public persistence-error and relocation notices. Before returning a successful prompt or configuration-change response, await persistence of the completed messages, effective session selection, and replay metadata as well as the existing write-settlement and update-queue boundaries. A failed save ends that operation with its cause and makes the attachment unavailable for further prompts until reopened successfully. Unexpected journal relocation or identity change is a visible failure, not a silent fork or new ACP identifier. Do not promise power-loss durability for uncommitted streaming chunks; the guaranteed recovery boundary is the last successfully persisted operation. No automatic replay of an interrupted tool's side effects occurs.

### Reconstructing a live attachment

`session/load` and `session/resume` share validation, ownership acquisition, engine construction, and cleanup. Require an absolute, existing, enterable `cwd` matching the journal's recorded directory after filesystem canonicalization. A removed or moved project is an explicit failure; do not silently relocate its conversation into the adapter's launch directory.

Acquire exclusive ownership of the saved session before repairing or extending it. A second live attachment, including another adapter process, fails as busy without changing the file, starting another turn, or forking the identity. A repeated load or resume of an already attached identifier on the same connection also fails before replay. Use the public storage ownership mechanism and retain the claim until teardown; observe unexpected SDK relocation rather than adopting it. A dead process must not permanently prevent reopening.

Construct the engine through the same `createPicoSession` path as a new session, supplying the opened manager instead of restoring into a less-restricted generic SDK session. Keep eval, built-in LSP, native task/agent/workpool delegation, extension-added tools, and unapproved indirect routes excluded. Reapply the Sesh child-launch adaptation and verify the final effective roster after MCP discovery.

Only the current request supplies MCP configuration. For resume, omitted `mcpServers` means `[]`. Never save or recover MCP server commands, environment variables, tokens, or prior connections as attachment configuration. An MCP failure has the same visible startup error and full cleanup as `session/new`; no partial roster or old-server fallback is accepted. Historical MCP invocations remain displayable even when that server is absent now, but cannot execute through their saved metadata.

Restore the session's saved effective model and thinking selection through public SDK session-history APIs. Existing model and thinking menus remain session-local: persisting their choice in this conversation does not change any OMP default. A saved model that is unavailable or whose credentials fail is an explicit restoration failure, never substitution with the project's current default. Return current `configOptions` for the restored selection. This extends the selectors' lifetime to the durable session without adding another selection API.

Do not admit prompts or configuration changes until attachment construction and, for load, replay have completed. Unknown saved identifiers use the SDK's session-not-found error; invalid parameters and busy attachments name the rejected condition. Storage, model, credential, and transport failures retain their cause. No failed restore returns a fresh session as success.

### Replaying the conversation

For `session/load`, reconstruct the full retained conversation on the active journal branch, not every entry in physical file order and not the compacted inference context. Use the public branch/transcript APIs. Preserve user and assistant message order, text and thinking content, and the supported historical tool inputs and results. Do not replay context-maintenance summaries as duplicate assistant answers alongside the original conversation, nor expose metadata entries as conversation messages. Compaction cannot erase earlier visible messages from the replay, and abandoned branches cannot reappear in it. This proposal does not add ACP compaction UI capabilities.

Use the original tool-call identifiers, scoped to the session. Emit one `tool_call` for each retained invocation and at most one terminal `tool_call_update`; a matching tool-result message completes that invocation instead of creating another card or appearing as a duplicate assistant message. Emit completed status for a recorded success and failed status for a recorded error or cancellation. Reuse the existing title, kind, location and content translation where their facts are available.

Save presentation facts unavailable from engine messages as versioned Pico custom entries in the same branch: tool identity/title information needed for display and the bounded file-change evidence already captured for a final tool card. Associate records with the original invocation and branch. They are presentation metadata, not a second set of messages, a source of engine instructions, or an authority for future tool admission. Validate their shape and version when reopening. Preserve the existing binary/unreadable/large-file/no-diff behavior; never read the current file to invent an earlier diff. A crash before a presentation record is committed leaves only the saved result and an explicit explanation that the additional presentation was not retained.

After exclusive ownership proves that the prior writer is gone, reconcile an interrupted saved tail through public SDK interrupted-turn helpers, including the abnormal-exit case with no exit marker. Persist missing error results and a terminal interrupted-turn record once, where needed, before rebuilding context and replaying. Preserve existing results. Repeated reopen must not append another copy of the same recovery records. If an operation may have changed files or an external service before it stopped, say its outcome is unknown; failed replay status is not evidence that its side effects were rolled back. No saved invocation remains pending or in progress after replay, and none is executed again by loading history.

Queue replay notifications through the session's ordered update path and await delivery before answering `session/load`. Dispose a failed or disconnected partial attachment; do not register it as ready. A transport interruption can leave the client with a partial replay, so the protocol does not promise exactly-once delivery across transports. The next fresh connection receives a complete replay once; a client that already owns its transcript uses resume instead.

`session/resume` follows the same reconstruction and recovery rules but emits no historical user, assistant, thought, or tool updates. Return only when the restored attachment is ready to accept a prompt, with its current configuration state in the response. A continuation must receive the saved context rather than starting an empty engine conversation.

### Listing Pico sessions

`session/list` discovers journals only below Pico's session root. With no `cwd`, list Pico sessions across its working-directory buckets; never call the SDK's default-root `SessionManager.listAll()` or use terminal OMP history as a fallback. The public `listAllSessions(storage, sessionsRoot)` supports an explicit root. With `cwd`, require an absolute path and filter by the recorded canonical working directory. Listing does not require the project directory or its configured model to remain usable; an unavailable project may still appear, with restoration failing explicitly if requested.

Flush this connection's live sessions before deriving listing metadata so successfully created empty sessions and completed turns are discoverable. Listing does not construct engines, connect MCP servers, resolve credentials, acquire a long-lived writer, or mutate another process's transcript. Derive `sessionId`, `cwd`, and `updatedAt` from the journal; include its saved title when present and omit an absent title rather than generating one with a model. Display metadata is not an independent source of session identity.

Return at most 50 sessions per page, ordered by update time descending and then session identifier ascending. A continuation cursor is an opaque, versioned encoding of the last ordering key and the directory filter; reject malformed or incompatible cursors rather than treating them as the first page. Continue after that key and omit `nextCursor` on the last page. Pagination is a live listing, not a frozen snapshot; a conversation updated between requests may move ahead of the cursor, and clients refresh from the first page to see it there.

Reject an invalid or unsupported journal selected for restoration with its identifier/path and cause; do not create an empty replacement, skip malformed records silently, or guess a newer format. Listing surfaces directory-read failures and invalid headers encountered during discovery rather than falsely reporting empty history; it does not fully parse every transcript to produce a page. Restoration validates the transcript it opens. Never follow an archive path outside the owned root to repair it.

### Disconnect and shutdown

Extend the existing connection lifecycle to include in-flight load/resume construction, replay, persistence observers, storage claims and opened managers, not just `session/new`. Mark the connection closed before awaiting cleanup, refuse new work, cancel active turns, settle writes, unsubscribe listeners, disconnect owned MCP processes, and await engine disposal and its journal close. Managers opened before engine ownership transfers must also close on every failed-start path. Release a storage claim only after its writer is closed.

A construction that finishes after disconnect disposes itself instead of entering the registry. Pending replay/client requests settle on transport closure and cannot keep an attachment alive. Late engine events cannot publish to a closed attachment or mutate a journal whose ownership was released. Preserve the existing bounded shutdown and diagnostic behavior: a failed or timed-out close produces an unclean exit with its outstanding step, not a false clean shutdown. Durable history survives ordinary teardown.

### Capabilities and evidence

After these paths are implemented and exercised, advertise `loadSession: true` and `sessionCapabilities: { list: {}, resume: {} }` in stable ACP v1. Keep the current prompt and MCP-transport capability limits unchanged. Do not add handlers or advertise support for fork, close, delete, ACP v2, or a new history-management API in this proposal.

Behavioral coverage derives from the sections above: two-process identity/context restoration, full replay after compaction, one card/result per invocation, interrupted-tail recovery without repeat effects, request-only MCP and identical policy after reopen, directory and terminal-history isolation, listing boundaries/pagination, unavailable-model and failed-save behavior, contested attachment, and disconnect during construction/replay/a turn. Keep deterministic protocol and storage coverage beside the affected adapter modules. Do not test source wording or duplicate the specification as assertion text.

Extend the executable smoke path to create a session, finish a turn, stop the process, list and reopen the same identifier in another process, check load replay, and continue it. Exercise resume separately and prove it emits no history. Use disposable state and a controlled provider for deterministic protocol evidence, then exercise a real model-backed conversation in Sesh: remember a distinctive fact, run successful and failed tools, stop the adapter, reopen the session, and continue with that fact. Observe which restoration method the installed host actually uses and inspect the real transcript and tool statuses for that path. A protocol driver covers any method Sesh does not invoke; do not present that as live-host rendering evidence.

Run `mise run check`, `mise run pico:verify`, and the applicable ACP compatibility-kit task against the actual executable. Verify the original OMP configuration/credential sources are still used, that no Pico history enters terminal OMP journals, custom-session pointers, blob storage or history indices, and that disconnect releases listeners, pending requests, storage claims and owned MCP processes. Report unexercised host behavior and platform limits explicitly. Extend the existing guide from this design before implementing; update its restart, state-location, selection-lifetime and removal sections, and carry a user-visible changeset with the implementation.

## Compatibility

Existing live-only Pico conversations cannot be recovered after their old adapter process exits: no durable archive or identity mapping exists to migrate. Do not import terminal OMP sessions or manufacture history from Sesh's displayed transcript. Persistence begins with sessions created by the new adapter.

Existing ACP clients can continue using new/prompt/cancel unchanged. Clients that advertise no restoration usage need no new setup. The model/thinking selection API and curated tool roster are unchanged; a conversation's session-local choices now survive its process. OMP-format compatibility follows the pinned SDK, with visible failure for unsupported or damaged archives rather than destructive rewriting or silent fallback.

Credentials and configuration remain in their existing sources. Pico history and its blob/index support live in the private storage roots; no global OMP configuration or terminal history is relocated. Existing credential refresh and the SDK's runtime lease location are not eliminated. New history contains prompts, replies, tool outputs, and retained file-change evidence, so it can contain sensitive project information. It is local application data, not an encrypted vault, cloud backup, or retention service.

## Implications on adoption

No new runtime, provider account, Homebrew install step, or Sesh registration API is introduced. Updating the executable enables persistence for subsequently created sessions. Application Support grows with retained conversations, blobs and artifacts; uninstalling the formula alone does not remove that history. Removing Pico's Application Support directory removes its history and supporting state without deleting OMP's own sessions or credentials.

An older Pico executable does not know how to attach these persisted conversations. Downgrading leaves the files intact but does not make that executable restoration-capable. Autonomous sessions remain out of scope because existing credential access is unchanged.

## Scope

- Pico-owned OMP-format history and supporting storage with stable ACP identity.
- Shared restricted reconstruction for new, load and resume; session-local selection restoration.
- Full, ordered load replay and final tool presentation, including truthful interrupted tails.
- Pico-only session listing, filtering and pagination.
- Persistence failures, exclusive attachment and disconnect/shutdown resource ownership.
- Guide updates, behavioral coverage, compiled/protocol smoke evidence, real Sesh verification and the implementation changeset.

### Out of scope

- A Pico-native or engine-independent history format, replacing OMP, or adding another engine abstraction. Mark selected storage separation only.
- Importing terminal OMP history, recovering old in-memory sessions, or migrating history from Sesh's private storage.
- New model selectors, provider configuration, credential migration, or Autonomous support; those are not session-history storage.
- Session fork/close/delete methods, relocation of removed worktrees, automatic retention/garbage collection, export UI, cloud sync, encryption, or a history browser in the unwritten Mac app.
- Persisting MCP connection configuration, automatically restarting old tool executions, changing shell permissions, or changing Sesh child-session behavior.
- Lossless recovery of every uncommitted streaming/progress chunk or exactly-once delivery across broken transports.

## Preview

- **Repository shape:** local stdio executable launched by Sesh.
- **Artifact:** `.build/pico` built from this pull request, plus the existing source launcher for development. A generated Xcode project, transcript, or screenshot is not the preview.
- **Access:** a local build used through an existing user-authorized Pico preview registration in Sesh. If a registration change is needed, use Sesh's supported UI/API with the human's permission; do not edit private registry files or replace their active agent silently. No public package or Homebrew release is needed for review.
- **Exercise:** create and use a real conversation, stop the adapter, reopen it, verify continuation context and the observed transcript/statuses, and check resource cleanup. Protocol-driving smoke evidence separately covers load/list/resume methods the host does not exercise.
- **Cleanup:** remove disposable projects, scratch histories and preview-specific artifacts created for verification. Preserve the user's conversations, credential store and existing registrations. Teardown of any changed registration requires the same explicit permission as its setup.

## Policies and decisions checked

- **Policies:** None. `policies/` contains only its index README.
- **Decisions:** None. `decisions/` contains only its index README.
- [VISION.md](../VISION.md) requires restoration through Sesh, truthful capabilities, visible execution, and no competing chat UI or hidden delegation backend. This proposal adds the missing restoration path without changing those boundaries.
- [Proposal 0001](0001-acp-adapter-core.md) defers restoration and durable identity. This proposal extends its ephemeral-session limitation and selection lifetime; its protocol, cancellation, approval-free policy and restricted roster remain intact.
- [Proposal 0002](0002-pico-homebrew-distribution.md) owns the executable and Application Support root. Preserve configuration/credential discovery rather than moving all reads to Pico's new storage root.
- [Proposal 0003](0003-pico-only-child-sessions.md) remains authoritative for admitted Sesh child launches, including reopened sessions.
- [PROTOTYPE.md](../PROTOTYPE.md) is the implementation brief, not approval. Its criterion 10 and request-only MCP, persistence isolation and cleanup requirements are covered here. No new standing policy or decision record is proposed.

## Future directions

A later proposal could define Pico's own portable history format, session export, retention controls, or history management in the companion app. None is required to keep current OMP-format conversations separate from terminal OMP history and reopen them correctly.

## Alternatives considered

- **Pico-owned transcript plus private OMP continuation state.** This separates history semantics from the engine but introduces two records that must remain consistent. Mark selected separate location only instead; this proposal retains one OMP-format journal.
- **Pico owns all resumable state in a new format.** Stronger engine independence requires defining translations for provider-specific messages, compaction, tool state and configuration. That is a different persistence contract, not a prerequisite for this restoration slice.
- **Only pass a Pico session directory to `SessionManager.create()`.** Small, but insufficient: blobs, title indices, and custom-session registration can still touch shared OMP state. Separate runtime storage from explicit configuration reads and suppress terminal breadcrumbs.
- **Use OMP's default history and filter it by a Pico tag.** This mixes ownership and can expose terminal conversations. Directory isolation is the stronger boundary.
- **Separate random ACP identifiers plus a mapping index.** A durable index adds a second authority without creating a distinct conversation concept. Reusing the persistent engine UUID removes that synchronization problem.
- **Replay the model context, all raw JSONL entries, or the live ACP stream verbatim.** Model context loses compacted conversation, file order includes abandoned branches, and raw live events retain stale in-progress states. Project full selected history with terminal tool outcomes instead.
- **A separate ACP event log.** It duplicates conversation content and needs cross-log crash reconciliation. Small custom presentation records in the existing journal retain bridge-only evidence without another conversation authority.

## Open questions

None about the selected storage-ownership boundary. Sesh's actual restoration calling pattern and complete runtime-storage/configuration isolation remain implementation verification requirements, not assumed capabilities. This proposal is `draft`; the human has approved its preparation, not implementation.
