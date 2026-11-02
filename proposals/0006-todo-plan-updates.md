---
id: proposal.0006
title: Todo List as the Sesh Plan
authors: [Mark Malstrom]
status: active-review
pull-request: https://github.com/markmals/pico/pull/43
issues: [https://github.com/markmals/pico/issues/26, https://github.com/markmals/pico/issues/38]
supersedes: []
---

# Todo List as the Sesh Plan

## Summary

Return OMP's `todo` tool to Pico and show its list only as Sesh's pinned plan, kept flat, complete and current after a reopen. Successful calls leave no transcript row; failed ones stay visible. Pico enables the tool, turns off stop-time reminders, and asks the model for one flat list.

## Motivation

A Pico session has no task list. [Proposal 0001](0001-acp-adapter-core.md#effective-roster) deferred OMP's `todo` tool until its input, progress, output, error and cancellation each had an ACP representation, and it named ACP `plan` updates as the intended one. Until then the model never receives the tool's schema, so a long task in Sesh has no visible progress beyond the transcript itself. [Issue #26](https://github.com/markmals/pico/issues/26) asks for the tool back.

The obvious representation is the one OMP's own ACP mode uses, and it reads badly in Sesh. [Issue #38](https://github.com/markmals/pico/issues/38) records it: every `todo` call becomes a tool call of kind `think`, which Sesh draws with the brain icon of its Thinking row, titled with the model's stated intent and expanding to a dump of the whole list. The same list also arrives as an ACP plan, so Sesh shows it twice. In this proposal's own Sesh session a 7-item list produced a 20-line brain-icon block per call, and clearing the list produced another brain-icon block reading "Todo list cleared." Mark wants to see only the plan pinned above the composer.

OMP's ACP mode has two further defects Pico must not copy. Loading a session replays every historical plan in order, and a stop-time reminder sends a plan holding only the unfinished items, which replaces the complete list in the client.

## Domain grounding

### Established context

- **ACP plans.** A `plan` session update carries a complete list of entries, each with `content`, a `priority` of `high`, `medium` or `low`, and a `status` of `pending`, `in_progress` or `completed`. "The Agent MUST send a complete list of all plan entries in each update … The Client MUST replace the current plan completely" ([agent plan](https://agentclientprotocol.com/protocol/v1/agent-plan.md)). The installed `@agentclientprotocol/sdk` 2.1.0 (stable v1) defines the same types, and no agent capability gates sending one. The specification says nothing about plans during `session/load` or `session/resume`, and nothing ties a plan to a tool call.
- **ACP tool calls.** `ToolKind` includes `think` ("internal reasoning or planning") and `other` (the default). Stable v1 has no `cancelled` tool-call status; Pico already ends a cancelled call as `failed` with the text "Cancelled".
- **OMP's `todo` tool** (`@oh-my-pi/pi-coding-agent` 18.14.0, `src/tools/todo.ts`):
    - Operations are `init`, `start`, `done`, `rm`, `drop`, `block`, `unblock`, `append` and `view`.
    - Items are grouped into ordered, named phases. Each item has `content`, a `status` of `pending`, `in_progress`, `completed`, `abandoned` or `blocked`, and an optional `blocker` note. Items are addressed by their exact text, and duplicates are rejected.
    - `init` with bare `items` stores them under a synthesized phase named "Tasks", and `append` fails without a `phase`.
    - `rm` with no target empties every phase.
    - A call with any error discards its whole batch and returns `isError` with the previous list.
    - The tool does no I/O and ignores its abort signal.
    - A successful call stores the new list on the session (`AgentSession.getTodoPhases()`), and its result `details.phases` holds that list.
- **The list survives a reopen.** OMP rebuilds the list from the newest successful non-`view` `todo` result on the active branch when a session is constructed or reopened, and after compaction or other history rewrites (`TodoTracker.syncFromBranch`). Pico does not need to store the list a second time.
- **Settings** (`src/tools/settings.ts`):
    - `todo.enabled` defaults to on. It is checked separately from `toolNames`, so listing `todo` does not override it.
    - `todo.reminders` defaults to on. When the agent stops with open items, OMP appends a hidden developer reminder and continues the same turn, up to `todo.remindersMax` (3) times. The same setting gates a mid-run nudge.
    - `todo.eager` defaults to letting the model decide whether to create a list.
    - `Settings.overlay()` changes any of these for one session without touching the user's configuration.
- **What Sesh draws** (Sesh 0.29.0, observed on 2026-11-02 in a real session driven by OMP's ACP mode):
    - The plan appears as a collapsible **Plan · N of M** panel pinned above the composer, outside the transcript. N counts completed entries.
    - Completed entries get a filled check and strikethrough text, the in-progress entry a blue ring, and pending entries an empty circle.
    - An update with no entries hides the panel.
    - Sesh stores the latest plan as `info.plan` (`{content, status}` with no priority) in its session file, and records no plan event in the transcript log.

### Relevant constraints and principles

- **Visibility.** [VISION.md](../VISION.md) requires every agent-requested execution to be visible to the client, with accurate results, errors and cancellation. The AGENTS.md hard rule and [PROTOTYPE.md](../PROTOTYPE.md#tool-policy-and-visibility) phrase this more narrowly: every executed tool produces an identifiable ACP tool call. This proposal amends that narrower wording (see Detailed design).
- **No silent fallback.** A failure reaches the client with its cause.
- **Pico's policy is per process and per session.** Pico overlays settings without rewriting the user's OMP configuration.
- **The roster check rejects extra tools.** The final active roster must be a subset of Pico's allowlist plus the request's MCP tools.
- **Current policy wins on reopen.** [Proposal 0004](0004-session-restoration.md) restores context, not old policy, and `session/resume` replays no history.

### Quality bar

When no turn is running, Sesh's plan matches the agent's real list, as flattened by the rules below, on every attachment. A list never appears in the transcript as a content dump. A failed or cancelled `todo` call stays visible. The client never receives a partial list or a sequence of historical plans.

### Remaining uncertainty

- Sesh's handling of a plan sent during `session/load` replay or before Pico answers `session/resume` has not been observed. Sesh 0.25.2 used `session/resume` when it reopened Pico ([proposal 0004](0004-session-restoration.md#feasibility-and-verification)). The preview must check that path in Sesh, and a protocol driver covers load.
- Steering the model toward one flat list is guidance, not enforcement. The model can still use phases, and Pico flattens them regardless.

## Existing baseline

- **The roster.** `adapter/engine/tool-roster.ts` lists seven built-in tools without `todo`. `adapter/engine/pico-session.ts` passes them as `toolNames` with `restrictToolNames: true` and then checks the final active roster.
- **Settings.** `adapter/engine/pico-settings.ts` overlays Pico's policy on the user's read-only settings, and has no `todo` keys.
- **Live tool calls.** `adapter/events/session-event-mapper.ts` reports each tool call once at `tool_execution_start` and settles it once at `tool_execution_end`. On cancellation, `closeOpenToolCalls()` closes every open call as `failed` "Cancelled". Calls get their kind and title from `toolKind()` and `toolTitle()` (`adapter/events/tool-call-translation.ts`), which have no `todo` case.
- **Replay.** `adapter/events/history-replay.ts` emits each historical tool call when it reaches the assistant message, and settles it at its result. A call with no saved result is settled as failed with "outcome is unknown".
- **What to keep.** Keep these unchanged for every other tool: the once-reported, once-settled invariant, the ordered update queue, the replay shape from 0004 (one `tool_call` and at most one terminal update per invocation), and the presentation records.
- **The guidance and the guide.** `adapter/engine/agent-guidance.ts` appends Pico's guidance to the system prompt. [`guides/running-pico-in-sesh.md`](../guides/running-pico-in-sesh.md) lists `todo` as not yet available.
- **Pico sends no plan anywhere today.**

OMP's own ACP mapping (`src/modes/acp/acp-event-mapper.ts`) is evidence, not a model to copy:

- `todo` maps to kind `think`, and the call carries the list as text.
- It sends a plan after each successful call, with priority fixed at `medium`, `abandoned` mapped to `completed`, `blocked` mapped to `pending`, and phase names dropped.
- It replays every historical plan on load.
- On a reminder, it sends a plan of only the unfinished items.

Keep the plan-after-success idea and the fixed priority; replace the rest.

## Proposed solution

Pico admits `todo`, enables it whatever the user's OMP setting, and turns off its stop-time reminders. Pico treats the engine's current list as the single source of the plan. It flattens the list (task text only, no phase names, abandoned items removed, blocked items labelled) and sends the complete flattened plan whenever it differs from the plan last sent on that attachment. A reopened session always gets the current plan once. A successful `todo` call reaches Sesh only as that plan, with no transcript row. A failed or cancelled call appears as a failed tool call carrying OMP's error text, and sends no plan.

```text
model: todo init [A, B, C]           → Plan · 0 of 3  (○ A, ○ B, ○ C); no transcript row
model: todo start A; todo done A     → Plan · 1 of 3  (✓ A, ◎ B, ○ C)
model: todo block C "needs review"   → C reads "C (blocked: needs review)", pending
model: todo drop B                   → B leaves the plan: Plan · 1 of 2
model: todo done "Z" (no such task)  → failed tool call "Task "Z" not found"; plan unchanged
model: todo rm                       → plan with no entries; Sesh hides the panel
Sesh reopens the session             → one plan with the current list, after any replay
```

### Ontology review

**Assessment: coherent, with one representation boundary made explicit.**

- **Concepts.** The _todo list_ is engine state: phased, five statuses, owned and persisted by OMP inside Pico's history. The _plan_ is Pico's ACP projection of it: flat, three statuses, and complete in every update. _Sesh's stored plan_ is the client's cached copy of the last plan it received. Only the todo list is authoritative. The plan is derived, and Sesh's copy can go stale across a crash, so a reopen resends it.
- **Vocabulary.** User-facing text says "plan", which is Sesh's word, and keeps "todo" for the tool's name.
- **Lossy projection, deliberately.** Phases, abandoned items and blocker states other than the label are not representable in the plan. The model's list and the user's plan can therefore differ in grouping. [Issue #44](https://github.com/markmals/pico/issues/44) records the eventual remedy: a Pico-owned flat tool.

## Detailed design

### Roster and settings

- Add `todo` to `PICO_BUILTIN_TOOLS`. It stays subject to the existing final-roster check on new, loaded and resumed sessions.
- Extend the overlay in `loadPicoSettings()` with `"todo.enabled": true` and `"todo.reminders": false`.
    - The tool is active even when the user's OMP configuration disables it.
    - OMP neither appends stop-time reminders nor mid-run nudges, so a turn ends when the model stops.
- Pico does not pin `todo.eager` or `todo.remindersMax`; they follow the user's OMP configuration (the latter has no effect while reminders are off).
- The overlay writes nothing to the user's configuration.
- Ignore the engine's `todo_reminder` and `todo_auto_clear` events. Neither produces an ACP update.

### Flattening the list into a plan

Build the plan from the engine's current list (`AgentSession.getTodoPhases()`), never from a tool's arguments:

- Walk phases in order and items in order within each phase. Phase names appear nowhere in the plan.
- `pending` → `pending`, `in_progress` → `in_progress`, `completed` → `completed`, each with the item's text as `content`.
- `blocked` → `pending`. The content is the item's text followed by ` (blocked: <note>)` when it has a blocker note, or ` (blocked)` when it has none.
- `abandoned` → omitted. The item leaves the plan, and Sesh's count shrinks accordingly.
- Every entry has `priority: "medium"`. ACP requires a priority, OMP's list has none, and Sesh does not store or draw it.
- An empty list, or one holding only abandoned items, produces a plan with no entries.

This flattening is a pure function of the list, so its tests need no session.

### When Pico sends a plan

Each attachment remembers the last plan it sent. A new session starts with an empty remembered plan.

- After every `todo` call ends, and again when a turn ends (completed, failed or cancelled), Pico flattens the engine's current list. When the result differs from the remembered plan in any entry's content, status, or the entries' order or number, Pico sends it as one complete `plan` update through the session's ordered update queue, then remembers it. Identical results send nothing.
- These sends happen before Pico answers the `session/prompt` request, so a turn's final plan arrives before its stop reason.
- The turn-end check also covers a `todo` call that a cancellation closed before its end event arrived. If the engine applied that call anyway, the turn-end plan shows the result; otherwise the plan stays as it was.
- Pico stores no plan in its history; the engine's saved `todo` results are the only source.

### The `todo` call in the transcript

A successful `todo` call is represented by the plan alone.

- On `tool_execution_start` for `todo`, Pico sends nothing. It holds the call's identifier, arguments and stated intent.
- On a successful `tool_execution_end`, Pico sends no `tool_call` or `tool_call_update` and records no presentation entry, then applies the plan rule above.
- On a failed `tool_execution_end`, Pico sends the deferred `tool_call` immediately followed by its terminal update:
    - The `tool_call` carries the original identifier, name `todo`, kind `other`, and status `in_progress`. Its title is the model's stated intent, or "Update plan" when there is none. Its raw input is the call's arguments.
    - The `tool_call_update` has status `failed`, OMP's error text as content, and OMP's result details as raw output.
    - Pico records the presentation as for any other tool. The failed call sends no plan of its own, because the engine discarded the batch.
- When a turn's open calls are closed by cancellation, a `todo` call that started but has not ended is reported the same way, with "Cancelled" as its content.
- Every other tool keeps its current reporting.

### Reopening a session

- **`session/load`.** Replay the transcript as [proposal 0004](0004-session-restoration.md#replaying-the-conversation) specifies, except for `todo` invocations:
    - Defer each `todo` call until its result. A successful result yields nothing.
    - An error result yields the `tool_call` and `failed` update described above, using its saved presentation when one exists.
    - A `todo` call with no saved result yields the `tool_call` and the existing "outcome is unknown" failure.
    - No historical plan is replayed. After the replay, send one plan with the current flattened list, even when it is empty, remember it, and only then answer the request.
- **`session/resume`.** Replay nothing, as today. Before answering, send one plan with the current flattened list, even when it is empty, and remember it. This corrects a stale copy in Sesh, for example after Pico stopped between changing the list and reporting it.
- **`session/new`.** Sends no plan.

### Model guidance

Append one line to `PICO_GUIDANCE`:

> - Keep the `todo` list flat: create it with `init` and `items` (no `list`), and add tasks with `append` and `phase: "Tasks"`. Sesh shows the list as a plan without phase names.

OMP's tool description and result text still mention phases; this proposal does not alter them.

### Rule and documentation amendments

- **AGENTS.md, hard rule** "Every agent-requested tool execution and delegated session is visible through ACP." Add: "A call whose entire effect is ACP plan state, today only a successful `todo`, is visible as that plan rather than as a tool call. A failed or cancelled one is still a tool call." Update the platform summary's "reports every tool call" to match.
- **[PROTOTYPE.md](../PROTOTYPE.md#tool-policy-and-visibility)** "Every dispatched agent tool must produce an identifiable ACP tool call." Add the same exception.
- **[`guides/running-pico-in-sesh.md`](../guides/running-pico-in-sesh.md)** Remove `todo` from "Not available yet", and describe what the user sees:
    - the pinned plan, its status marks, and the flat list;
    - abandoned items leaving the plan, and blocked items labelled;
    - no transcript rows for successful updates, and failed updates shown as failed calls;
    - the plan reappearing on reopen.

    Write the guide from this section before writing the code.

- **Changeset.** A user-visible minor changeset.

### Verification

Behavioral coverage lives beside the affected modules:

- **Flattening:** order, every status, blocker labels, omitted abandoned items, empty lists.
- **Mapper:**
    - no updates for a successful call;
    - a plan only when the flattened list changes;
    - a failed call reported once with its error text and no plan;
    - a cancelled open call reported as failed "Cancelled", followed by a turn-end plan that reflects the engine's list.
- **Replay and restoration:**
    - no `todo` rows for successes;
    - failed and interrupted calls replayed once;
    - no historical plans;
    - exactly one current plan after load replay and on resume, before the response.
- **Settings:**
    - `todo` is active when the user's configuration disables it;
    - a turn that ends with open items ends without continuing;
    - the user's configuration file is unchanged.
- **Roster and guidance:** the roster test includes `todo`, the excluded-tool fixture no longer lists it, and the guidance reaches the system prompt.

Run `mise run check`, `mise run pico:verify` and `mise run pico:tck`. Then exercise the preview in a real Sesh session.

## Compatibility

- **Model behavior.** Every Pico session now offers `todo`, including for users whose OMP configuration disables it, and Pico never sends OMP's todo reminders.
- **Reopening sessions.** Sessions saved by earlier Pico versions contain no `todo` results, so their first reload or resume sends an empty plan, which Sesh shows as no panel.
- **Other ACP clients.** Clients without a plan view still receive standard ACP `plan` updates. They see no record of successful `todo` calls, which is the accepted cost of the rule amendment.
- **Unchanged.** Every other tool's reporting, the restoration format, and the user's OMP configuration.

## Implications on adoption

No new runtime, setup step, registration change or capability flag. Updating the executable enables the tool and the plan. Reverting to an earlier executable removes the tool again; saved sessions, including their `todo` results, stay readable, and their reminders stay off because OMP sends them only while `todo` is an active tool.

## Scope

- Admit `todo`; pin `todo.enabled` on and `todo.reminders` off.
- Flatten the engine's list into complete ACP plans, sent on change, at turn end, and once on load and resume.
- Represent successful calls by the plan alone, and failed or cancelled calls as failed tool calls, both live and in replay.
- Add the flat-list guidance line.
- Amend the AGENTS.md and PROTOTYPE.md visibility rules; update the guide; add the changeset.
- Add the behavioral coverage, run the compiled checks, and exercise the preview in Sesh.

### Out of scope

- A Pico-owned flat `todo` tool, which would make the model's list and the plan identical. Deferred to [#44](https://github.com/markmals/pico/issues/44).
- Changing OMP's `todo` tool description or result text, or patching OMP.
- Plan-mode approval, ACP session modes, slash commands such as `/todo`, or a user-editable plan.
- Exposing `todo` settings in the Mac app.
- Fixing OMP's own ACP mapping.

## Preview

- **Repository shape:** a local stdio executable launched by Sesh.
- **Artifact:** `.build/pico` built from this pull request, or the `.build/pico-acp` development launcher, used through the existing user-authorized Pico preview registration in Sesh. If a registration change is needed, it goes through Sesh's supported UI with the human's permission.
- **Exercise:**
    1. In a disposable project, ask Pico for a multi-step task. Watch the plan panel appear and update, with no `todo` rows in the transcript.
    2. Drop one item and block another, and check the plan shows each as specified.
    3. Provoke a failed call by asking the agent to complete a task that is not on the list. Check it appears as a failed tool call and the plan is unchanged.
    4. Ask the agent to clear the list, and check the panel disappears.
    5. Stop Pico and reopen the session. Check the panel matches the agent's list.
- **Cleanup:** remove the disposable project and its Pico history. Preserve the user's sessions and registrations.

## Policies and decisions checked

- **Policies:** None. `policies/` contains only its index README.
- **Decisions:** None. `decisions/` contains only its index README.
- **[VISION.md](../VISION.md)** requires agent-requested execution to be visible, with accurate results, errors and cancellation. A successful `todo` call's entire effect is visible as the plan, and failures and cancellations remain tool calls, so the vision's wording holds. The narrower AGENTS.md and PROTOTYPE.md rules ("visible through ACP" phrased as one tool call per execution) conflict with hiding successful calls. Mark chose on 2026-11-02 to amend both rules narrowly rather than keep a visible `todo` row.
- **[Proposal 0001](0001-acp-adapter-core.md)** deferred `todo` until its ACP representation was defined and named plan updates as the intended one. This proposal defines that representation, and it adds the tool to the roster check rather than bypassing it.
- **[Proposal 0004](0004-session-restoration.md)** governs replay and resume. This proposal keeps its replay shape and adds one current plan to each reopen, which is state rather than history.
- **[Proposal 0003](0003-pico-only-child-sessions.md)** is unaffected.
- **The AGENTS.md hard rule "Never rewrite the user's global OMP configuration"** holds: the setting pins are a per-session overlay.

## Future directions

- A Pico-owned flat todo tool ([#44](https://github.com/markmals/pico/issues/44)) would remove phases from the model's view too, and let the plan carry the tool's state without loss.
- The Mac app could expose `todo` and its reminders as settings once it writes Pico configuration.

## Alternatives considered

- **OMP's ACP mapping as is.** Rejected: the brain icon reads as reasoning, the list appears twice, load replays stale plans, and reminders send partial lists.
- **A visible `todo` call of kind `other` with a one-line summary.** This needs no rule change and adds one small row per call. Mark preferred to see only the plan.
- **Hide every `todo` call, failures included.** Rejected: a failed call changes nothing in the plan, so the failure would vanish, against "never fall back silently".
- **Map `abandoned` to `completed` (OMP) or label it.** Sesh's check and strikethrough would claim abandoned work was finished. Mark chose to omit abandoned items.
- **Prefix entries with phase names.** This clutters every row, and Sesh has no headings. Mark chose a flat list, steering the model toward it and deferring a Pico-owned tool to #44.
- **Honor the user's `todo` settings.** This would match how Pico treats `grep.enabled`, but a disabled tool or a hidden reminder continuing the turn would make Pico's behavior depend on terminal configuration. Mark chose to pin the tool on and reminders off.
- **Build each plan from the tool result's details.** This is equivalent for live successes but misses an applied call that a cancellation closed, and it needs a second source on reopen. The engine's current list covers live, cancelled and reopened cases with one source.
- **Send no plan on reopen, or only on load.** Sesh's stored copy is usually right, but it goes stale if Pico stops between a change and its report. Mark chose one current plan on both load and resume.

## Open questions

None. Mark settled the status mapping, the flat list, the settings, reopen behavior and call visibility on 2026-11-02.
