---
id: proposal.0008
title: Background Bash Jobs and Wait
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/45
issues: [https://github.com/markmals/pico/issues/27, https://github.com/markmals/pico/issues/12]
supersedes: []
---

# Background Bash Jobs and Wait

## Summary

Show OMP's background `bash` jobs in Sesh and return `wait`. A job streams its output and outcome into the `bash` call that started it and belongs to that turn: the turn ends after its jobs, and cancelling or disconnecting kills them. Auto-background becomes a Pico setting; service mode stays off.

## Motivation

[Proposal 0001](0001-acp-adapter-core.md#effective-roster) deferred `wait` until OMP's background `bash` jobs had an ACP representation for their input, progress, output, error and cancellation. [Issue #27](https://github.com/markmals/pico/issues/27) asks for it back.

Pico already runs background jobs, though, without any such representation:

- Pico sets none of `async.enabled`, `launch.enabled` and `bash.autoBackground.enabled`, and OMP turns all three on by default. Released Pico 0.1.0 takes them from the user's OMP configuration; since [proposal 0007](0007-pico-owned-configuration.md), Pico sessions take OMP's built-in defaults under Pico's overrides, and on 2026-11-02 `picoSettings()` on `main` still resolved all three on. The model's `bash` tool therefore offers `async`, plus service mode's `name` and `ready`, and any plain command still running after 60 seconds moves to the background on its own. This repository's own `mise run check` takes about a minute.
- When a command moves to the background, Sesh shows its call as completed, carrying OMP's model-facing notice ("Backgrounded as job bg_1 … Do NOT poll for it …"). The command's output never reaches Sesh.
- When the job ends, OMP starts a new run by itself to hand the result to the model. Pico reports nothing from that run. Its text and any tool it calls never reach Sesh, and Sesh has nothing to cancel. In a protocol-level check on 2026-11-02, the model's `write` in such a run created a file while the client received no tool call at all.

That breaks proposal 0001's rule that every executed tool is one visible tool call, and the brief's requirement that cancellation leaves no orphaned execution. On 2026-11-02 Mark chose to close the gap through this proposal rather than with a separate interim change, so it stays open until this one ships.

## Domain grounding

### Established context

- **ACP turns.** A prompt turn runs from the client's `session/prompt` until the agent answers it. Session updates may arrive outside a turn, but ACP v1 has no way for the agent to start a turn of its own. On `session/cancel` the agent stops its tool calls, sends its remaining updates and then answers `cancelled`; the client should mark the turn's unfinished calls as cancelled ([prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md)).
- **ACP tool calls.** A `tool_call_update` replaces the fields it carries. Statuses are `pending`, `in_progress`, `completed` and `failed` ([tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md)).
- **OMP's background jobs** (`@oh-my-pi/pi-coding-agent` 18.14.0, from its source and from spikes through Pico's own `createPicoSession` on 2026-11-02):
    - **Settings** (`src/tools/settings.ts`, `src/exec/settings.ts`):
        - `async.enabled` (default on) adds `async` to `bash` and admits `wait`.
        - `bash.autoBackground.enabled` (default on) and `bash.autoBackground.thresholdMs` (default 60 000) move a plain command to the background. They work whether or not `async.enabled` is on.
        - `launch.enabled` (default on) adds service mode to `bash` (`name`, `ready`) and the mode and stdin controls under `proc://`. Some service modes outlive the process that started them.
        - `async.maxJobs` (default 100) caps running jobs.
        - The defaults `omp acp` and `omp rpc` re-pin for their own hosts (`protocolDefault`) do not apply to an embedder.
    - **`wait` admission.** OMP admits `wait` when `async.enabled` is on, when IRC is enabled (which follows `task.maxRecursionDepth`), or when `launch.enabled` is on (`src/tools/index.ts:782-788`).
    - **Jobs.** Every top-level session owns one job manager, whatever the settings. Jobs are numbered `bg_1`, `bg_2` and so on within the session.
    - **Backgrounding.** When a `bash` call moves to the background, its result returns at once with `details.async = {state: "running", jobId}` and the notice text. The engine then keeps emitting `tool_execution_update` events under the same tool call ID. Each carries the output so far, and the last one carries `details.async.state` set to `completed`, `failed` or `cancelled`, with OMP's final text. A failure reports `exitCode` ("Command exited with code 3") or `timedOut` ("[Command timed out after 1 seconds]"); a cancellation reads "[Command cancelled]".
    - **Delivery.** A finished job's result goes to an in-flight `wait`, or else becomes a hidden `async-result` message. When the session is idle, OMP starts a new run to deliver that message (`injectIdle` in `src/session/agent-session.ts`), even when the client bridge sets `deferAgentInitiatedTurns`. A run that ends while one of its jobs still runs emits `agent_end` with `awaitingAsyncWork: true`.
    - **`wait`.** It takes no parameters, awaits the jobs' own promises without polling, and gives up after 30 minutes. Every 500 ms it reports progress as empty text with a `details.jobs` snapshot of each job's ID, status and label. It returns a report of the jobs that finished. If the turn is aborted, it fails with "Operation aborted".
    - **Stopping jobs.** `AgentSession.abort()` does not stop jobs. `cancelAsyncJob(id)` and `dispose()` do, and neither starts a delivery run for the job it cancelled. The kill reaches children started with `&`. A process that ignores SIGTERM dies about a second later, after its job has already reported `cancelled` and after `dispose()` has resolved. When the test process exited within half a second of `dispose()`, such a process survived as an orphan.
    - **Public API.** `settleAsyncWork()`, `hasPendingAsyncWork()`, `cancelAsyncJob()` and `asyncJobManager` are public members of `AgentSession`. Each running job carries a `promise` and, for a command, `process.pids()`.
    - **`proc://`.** The model can already read job state with `read proc://…` and kill a job with `write proc://<id>/kill`, through Pico's `read` and `write` tools.
- **OMP's own ACP mode** (`src/modes/acp/`) settles a backgrounded call from its last update. Before answering a prompt it waits for pending deliveries, but for at most three passes of 250 ms each.
- **What Sesh does** (Sesh's record of this proposal's own session, driven by OMP's ACP mode): when a 64-second command moved to the background, Sesh showed its call completed, then accepted later `in_progress` updates and a final `completed` update for it while the turn was still running.
- **Pico's settings** ([proposal 0007](0007-pico-owned-configuration.md), merged):
    - Every Pico session uses `Settings.isolated`: OMP's built-in defaults with Pico's overrides, reading no OMP settings file.
    - `~/Library/Application Support/Pico/settings.json` is a strict version-1 JSON object. Its only members are `version` and the optional pair `defaultModel` and `defaultThinking`; any other member makes the file invalid. Reading it yields `missing`, `valid`, `unsupported` or `invalid`.
    - `session/new` reads the file each time and fails on an unsupported or invalid file. `session/load` and `session/resume` do not read it, so an invalid file never stops a session from reopening.
    - Only `pico settings update` writes the file, atomically and revision-checked. `pico settings get` reports the saved `item` (with `null` for what is not set) and the `effective` values. Both commands, their options, help, schema output and search index are generated from one registry, and each option is named after the JSON member it sets.

### Relevant constraints and principles

- **Visibility.** [VISION.md](../VISION.md) requires every agent-requested execution to be visible, with accurate progress, results, errors and cancellation. The AGENTS.md hard rule adds that a shell operation's subprocess activity is reported within its tool call.
- **Cancellation and teardown.** [PROTOTYPE.md](../PROTOTYPE.md#acp-session-and-execution-behavior) requires cancelling owned subprocess activity without an orphaned execution or a permanently busy session, and releasing owned resources on disconnect.
- **No delegation through `wait`.** Issue #27: `wait` must not become a route back to OMP's excluded native delegation.
- **Policy is Pico's.** Mark directed on 2026-11-02 that Pico use only its own settings from now on: auto-background comes from Pico's settings file, and every OMP setting this proposal depends on is pinned to Pico's own value rather than left to OMP's built-in default.
- **No silent fallback.** A failure reaches the client with its cause. The one fallback here, Pico's default auto-background when a reopen meets an unusable settings file, is Mark's explicit choice; it is logged, and the same file fails the next `session/new`.

### Quality bar

Every command the model runs, in the foreground or in the background, is one tool call whose output and final status Sesh shows. Everything the model does after a job ends happens in a turn the user started and can stop. No turn ends with a job still running, and no process a job started outlives its session.

### Remaining uncertainty

- How Sesh presents a turn held open for many minutes, including any client-side limit, has not been observed. The preview checks it.
- Whether `process.pids()` includes grandchildren in other process groups, and empties only once they have exited, is unverified. The implementation must prove the SIGTERM-ignoring case rather than assume it.

## Existing baseline

- **Roster and settings.** `adapter/engine/tool-roster.ts` has no `wait`. `picoSettings()` in `adapter/engine/pico-settings.ts` builds `Settings.isolated` with Pico's overrides and sets no async, launch or auto-background keys. `task.maxRecursionDepth: 0` already keeps IRC off. The final-roster check in `adapter/engine/pico-session.ts` rejects any active tool outside the allowlist.
- **Pico's settings file.** `adapter/settings/settings-document.ts` parses and serializes version 1. `adapter/cli/registry.ts` declares `settings get` and `settings update`, whose handlers live in `adapter/cli/commands/`. `adapter/server/session-factory.ts` reads the saved default model for `session/new` only (`adapter/engine/saved-default.ts`); reopened sessions read no settings.
- **Live tool calls.** `adapter/events/session-event-mapper.ts` reports a call at `tool_execution_start`, settles it at `tool_execution_end`, and drops later updates ("a settled call must not come back to life"). A backgrounded call therefore settles as completed with the notice, and its job's updates are discarded.
- **The turn.** `SessionRuntime.prompt()` (`adapter/server/session-runtime.ts`) maps engine events only while `engine.prompt()` is pending, so a delivery run after that is never reported.
- **Cancellation.** `cancel()` calls `abort()` under 0001's bounds, and `closeOpenToolCalls()` fails every open call with "Cancelled". Jobs survive it.
- **Teardown.** `PicoSession.dispose()` disconnects MCP servers and then disposes the engine, which cancels its jobs. `adapter/main.ts` exits once shutdown completes, or after 5 seconds with a diagnostic naming the step still outstanding.
- **Replay.** `adapter/events/history-replay.ts` uses a call's saved presentation only when it completed, and otherwise rebuilds the result from the saved message. It does not replay hidden `async-result` messages.
- **The guide.** [`guides/running-pico-in-sesh.md`](../guides/running-pico-in-sesh.md) lists `wait` as not yet available.
- **What to keep.** The once-reported, once-settled invariant, the ordered update queue, 0004's replay shape, 0001's cancellation bounds and the shutdown diagnostics.

OMP's ACP mode is evidence, not a model. Keep settling a backgrounded call from its last update. Replace its bounded delivery drain, which still lets a late result start a run outside any turn the client started, and its display of the model-facing notice.

## Proposed solution

Pico turns async on and service mode off, admits `wait`, and treats a background job as the rest of the `bash` call that started it. The call stays running in Sesh, streams the job's output and ends with the job's outcome. A job belongs to the turn that started it. Pico does not answer the prompt while a job runs or while its result has yet to reach the model, so OMP's delivery run happens inside the user's turn, visible and cancellable. Cancelling the turn kills its jobs, disconnecting kills every job, and no process survives either. Pico's settings file gains `autoBackground`, on unless the user turns it off, which decides whether a command still running after 60 seconds moves to the background on its own.

```text
model: bash "make test", async          → "make test" in progress, streaming output; "Running in the background as job bg_1."
model: ends its reply                   → the turn stays open in Sesh
bg_1 exits 0                            → "make test" completed with its output; the agent continues in the same turn
model: bash "./slow.sh" past threshold  → the same call keeps running, now in the background
model: wait                             → "Wait for background jobs": "bg_2 — running — ./slow.sh"; completes when bg_2 ends
user presses Stop                       → the model stops, every job is killed, their calls fail; the turn is cancelled
Sesh disconnects                        → every job's processes are gone before Pico exits
```

### Ontology review

**Assessment: coherent, with one representation boundary made explicit.**

- **Background job.** An OMP job (`bg_N`, unique within one engine session) running one `bash` command. Each job has exactly one starting `bash` call, and in Sesh that call is the job: there is no second row. The call stays in progress for as long as the job runs.
- **Two projections of one execution.** The model sees the call return at once with OMP's notice, and learns the outcome later through `wait` or a hidden delivery message. The user sees one call that runs until the job ends. The job's final state alone decides the call's status.
- **Turn.** An ACP turn is the user's prompt plus every engine run it causes, including delivery runs for finished jobs. OMP's `agent_end` does not end the turn.
- **Vocabulary.** User-facing text says "background job", OMP's own word in its notice. `async` remains only the parameter's name.
- **Services stay a separate concept.** OMP's launch services are long-lived, can outlive the session, and remain excluded.
- **Auto-background is a Pico setting, not a session choice.** No session records it. Each attach reads it, and an attached session keeps the value it attached with until it is reopened.

## Detailed design

### Roster and settings

- Add `wait` to `PICO_BUILTIN_TOOLS`. It stays subject to the final-roster check on new, loaded and resumed sessions.
- Extend `picoSettings()`'s overrides with Pico's own values for every OMP setting background jobs depend on, so none is left to OMP's built-in default:
    - `"async.enabled": true`. With IRC already off, this is the only clause that admits `wait`.
    - `"launch.enabled": false`. `bash` never offers `name` or `ready`.
    - `"async.maxJobs": 100`. A call refused at that limit fails with OMP's error.
    - `"bash.autoBackground.enabled"`: the session's auto-background setting, below.
    - `"bash.autoBackground.thresholdMs": 60000`, fixed by Pico.
- `wait` can therefore only wait on this session's background jobs: no service, message or agent reply exists for it to wait on.

### The `autoBackground` setting

- Version 1 of `settings.json` gains one optional member, `autoBackground`, a boolean. Mark chose on 2026-11-02 to extend version 1 rather than define version 2: no released Pico reads `settings.json` yet.

    ```json
    {
        "version": 1,
        "defaultModel": "anthropic/claude-sonnet-5-5",
        "defaultThinking": "high",
        "autoBackground": false
    }
    ```

    - `autoBackground` is independent of the default-model pair; a file may hold either, both or neither.
    - A value that is not a boolean makes the file invalid, with its JSON path as the problem, like any other malformed member. Any other unknown member is still invalid.
    - A save writes the member only when it is set, so a file that never set it is written exactly as proposal 0007 writes it.

- **Pico's default is on.** A session whose file leaves `autoBackground` unset gets auto-background on.
- **On** sets `bash.autoBackground.enabled` true: a plain command still running after 60 seconds moves to the background in the same call. **Off** sets it false: only a call with `async: true` starts a job, and a slow plain command blocks until it ends or times out.
- **Every attach reads the file**, so a save applies from the next `session/new`, `session/load` or `session/resume` without restarting `pico`. A session already attached keeps the value it attached with.
    - **`session/new`** fails on an unsupported or invalid file, as proposal 0007 already specifies.
    - **`session/load` and `session/resume`** keep 0007's guarantee that a settings file never stops a reopen. A missing file, or a valid one without the member, gives Pico's default. An unsupported or invalid file gives Pico's default too, and Pico writes one line to stderr naming the file and its problem. Mark chose this fallback on 2026-11-02; the same problem fails the next `session/new` and is reported by `pico settings get`.
- **`pico settings update --auto-background <on|off>`** sets the member:
    - The registry declares the option with the value name `state`, the accepted values `on` and `off`, and search keywords including "background", "bash" and "job". Help, schema output and search come from that declaration.
    - The command's required-option rule becomes at least one of `--default-model`, `--default-thinking` and `--auto-background`. Its `INVALID_ARGUMENT` description, and the error for any other value, list the accepted values.
    - Given only `--auto-background`, the update reads and checks the file and its revision but resolves no model catalog, so it needs no usable credentials. It keeps any saved default model and thinking level.
    - Changing the default model or thinking level keeps a saved `autoBackground`.
    - Revision checks, `--dry-run`, idempotency and the receipt are unchanged; the receipt's `before.item` and `after.item` carry `autoBackground`.
    - No command unsets the member. Deleting `settings.json` returns every setting to its default, as 0007 specifies for the default model.
- **`pico settings get`** adds `autoBackground` to `item` (`null` when unset) and to `effective` (the value a new session would attach with: the saved value, or Pico's default). `effective` stays `null` for an unsupported or invalid file, as 0007 specifies.
- These are additive members of existing results, so `apiVersion` stays 1.

### The starting `bash` call

A call starts a background job when its `tool_execution_end` result carries `details.async.state: "running"`, whether the model asked for `async` or the command ran past the auto-background threshold.

- At that `tool_execution_end`, Pico does not settle the call. It sends a `tool_call_update` that keeps the status `in_progress`, and whose content is the output the command has produced so far (omitted when there is none), followed by a text block reading `Running in the background as job <jobId>.` OMP's model-facing notice is not shown.
- Each later `tool_execution_update` for the call whose `details.async.state` is `running` replaces the content with the cumulative output and the same line.
- The update whose state is `completed` settles the call `completed`. A state of `failed` (an exit status or a timeout) or `cancelled` settles it `failed`. Its content is OMP's final text, and its raw output is the update's `details`. Pico records that terminal update as the call's saved presentation ([proposal 0004](0004-session-restoration.md)).
- The call is still reported once and settled once. Updates that arrive after it settled are ignored.
- A foreground `bash` call and every other tool keep their current reporting.
- When the model kills a job with `write proc://<id>/kill`, the `write` is reported as usual, and the job's own call settles `failed` from its `cancelled` update.

### `wait`

- The `tool_call` has name `wait`, kind `other`, and the model's stated intent as its title, or "Wait for background jobs" when there is none. Its raw input is the call's arguments.
- OMP's progress updates carry empty text. Pico renders each snapshot in `details.jobs` as one line per job, `<id> — <status> — <label>`, and sends a `tool_call_update` only when that text differs from the last one it sent for the call. Durations are left out, so the call does not change every 500 ms.
- The result settles like any other tool: completed with the report text returned to the model, including "Nothing to wait for", or failed with OMP's error.
- A `wait` still open when its turn is cancelled is closed with 0001's "Cancelled".

### When a turn ends

- Pico answers `session/prompt` only once all of these hold:
    - the engine's prompt has resolved;
    - no background job the session owns is running;
    - no finished job's result is still waiting to reach the model;
    - the engine is idle.
- OMP's delivery run for a finished job is part of the same turn. Its text, thoughts and tool calls are reported like the rest of the turn, and the stop reason comes from the turn's last assistant message, as today.
- Pico waits on the jobs and the engine (`settleAsyncWork()`, and each running job's `promise` for jobs whose delivery OMP has suppressed), never by polling.
- If the engine's prompt or a delivery run fails while jobs are running, Pico cancels those jobs as described below, then answers with the failure.
- A second `session/prompt` while a turn is held still fails with the existing "a turn is already running" error.
- 0001's rule that a turn is not released until its bridged file writes land also covers writes made during delivery runs.
- Every turn therefore ends with no job running: a completed turn waited for its jobs, and a cancelled or failed turn killed them.

### Cancellation

- On `session/cancel` during a turn, Pico calls `abort()` as today and cancels every running background job the session owns. All of them belong to this turn.
- Each cancelled job's call settles `failed` from the job's `cancelled` update. If the turn's open calls are closed before that update arrives, the call gets 0001's "Cancelled" instead.
- A cancelled job starts no delivery run, and its result does not reach the model.
- Pico answers `cancelled` only after the abort has settled and every cancelled job's processes, including processes that ignore SIGTERM, have exited.
- 0001's stuck-cancellation rule gains a fifth case: the abort settled, but a cancelled job's processes are still running 5 seconds later. As in the other four, Pico answers `cancelled`, closes the session (whose disposal kills what remains), and logs the failure to stderr.
- After a cancellation that settles, the next prompt runs normally.

### Disconnect and shutdown

- Disposing a session cancels every job it owns: on client disconnect, at shutdown, and when a stuck cancellation closes it. Disposal completes only once those jobs' processes have exited, including processes that ignore SIGTERM.
- `PicoSession.disposalPhase` gains a phase, "stopping background jobs". If teardown hits `main.ts`'s 5-second limit, the shutdown diagnostic names it like the existing phases.
- No process a job started outlives Pico's exit.

### Reopening a session

- A replayed `bash` call whose saved result carries `details.async.state: "running"` is settled from its saved presentation, whether that presentation completed or failed.
- If such a call has no saved terminal presentation (the process stopped while its job ran), Pico replays it with 0004's failure: "The previous process ended before bash returned; its outcome is unknown."
- Hidden `async-result` messages are still not replayed.
- A replayed `wait` call follows the ordinary rules.
- `session/resume` replays nothing, as today.

### Model guidance

Append one line to `PICO_GUIDANCE`:

> - A background `bash` job belongs to the turn that started it: Sesh shows the turn as running until every job ends, and stopping the turn kills them. Don't start a server or watcher in the background expecting it to outlive your reply.

OMP's `bash` and `wait` descriptions are unchanged, including `wait`'s mention of services and message replies that cannot occur in Pico.

### Documentation

- **[`guides/running-pico-in-sesh.md`](../guides/running-pico-in-sesh.md).** Remove `wait` from "Not available yet". Describe:
    - a background command running inside its own call, with its job ID;
    - auto-background, `pico settings update --auto-background on|off`, and when a change takes effect;
    - the turn staying busy until jobs end;
    - `wait`;
    - Stop and disconnect killing jobs;
    - how an interrupted job looks after reopening.

    Write the guide from this section before writing the code.

- **AGENTS.md platform summary.** Add background jobs within their turn to what the adapter reports.
- **Changeset.** A user-visible minor changeset.

### Verification

Behavioral coverage lives beside the affected modules:

- **Settings and roster:**
    - `wait` is active, and the roster check and excluded-tool fixture are updated;
    - `bash` offers `async` but not `name` or `ready`;
    - the session's settings resolve `async.enabled`, `launch.enabled`, `async.maxJobs` and the threshold to Pico's values;
    - a plain slow command moves to the background with `autoBackground` unset or true, and stays in the foreground with false;
    - new, loaded and resumed sessions read the current file; a reopen with an unsupported or invalid file attaches with Pico's default and writes the stderr line, while `session/new` fails on it.
- **Settings file and commands:**
    - reading `autoBackground` true, false and absent, a non-boolean value, and a file holding only `autoBackground`;
    - saving it alone (with no usable credentials), with a model change, and keeping it across a model change;
    - a model save of a file that never set it writes the bytes proposal 0007 writes;
    - `--dry-run`, `--if-revision`, idempotency and an invalid value with its accepted values;
    - `settings get`'s `item` and `effective`, and the option in help, schema output and search.
- **Mapper:**
    - a backgrounded call stays `in_progress` with output and the job line;
    - running updates replace its content;
    - `completed`, exit-status, timeout and `cancelled` updates settle it once;
    - later updates are ignored;
    - `wait` progress lines are sent only on change;
    - the model-facing notice is never sent.
- **Turn:**
    - a turn whose model ends its reply while a job runs answers only after the job's delivery run, and that run's tool calls are reported;
    - a job watched by `wait` causes no delivery run;
    - a failed delivery run cancels remaining jobs and answers with the failure.
- **Cancellation and teardown:**
    - cancelling during a job and during `wait` kills the job, settles the calls failed, and lets the next prompt run;
    - a job whose process tree ignores SIGTERM leaves no process after cancellation, after disposal, or after the `pico` executable exits on disconnect;
    - the fifth stuck-cancellation case closes the session.
- **Replay:** a settled background call replays its saved outcome; an unsettled one replays as unknown.
- **Guidance** reaches the system prompt.

Run `mise run check`, `mise run pico:verify` and `mise run pico:tck`, then exercise the preview in a real Sesh session.

## Compatibility

- **Visible jobs.** Background commands now appear as running calls with their output, and the model's work after a job ends now appears in the transcript. Before, both were invisible.
- **Longer turns.** A turn now lasts until its background jobs end. A command run with `timeout: 0` keeps the turn open until it exits or the user stops it.
- **Service mode removed.** `bash` loses `name` and `ready`, which Pico offered unintentionally.
- **Settings.** `async` is always on, the job limit and auto-background threshold are Pico's, and auto-background is on unless the user turns it off in Pico's settings, which matches what OMP's defaults do today.
- **Settings file.** Files without `autoBackground` read and save as before. A file that sets it is invalid to a Pico built from proposal 0007 alone; no released Pico reads `settings.json` yet.
- **Older saved sessions.** A backgrounded call saved by an earlier Pico has a saved presentation that completed with OMP's notice. It replays as it was shown then.
- **Unchanged.** Foreground tools, `todo` plans, restoration format and the user's credentials.

## Implications on adoption

This builds on proposal 0007's settings file and commands, already merged. It adds no runtime, setup step, registration change or capability flag. A user who wants slow commands to block runs `pico settings update --auto-background off`. Reverting to an earlier executable restores today's invisible background jobs, and sessions saved by this version stay readable. An executable that has proposal 0007 but not this one rejects a settings file that sets `autoBackground` until the member is removed by hand.

## Scope

- Admit `wait`; pin `async.enabled` on, `launch.enabled` off, the job limit and the threshold.
- Add `autoBackground` to Pico's settings file, `pico settings update` and `pico settings get`, and apply it on every attach.
- Report background jobs within their starting `bash` call, and `wait` with its progress.
- Hold each turn until its jobs and their delivery runs finish; cancel jobs on cancellation, failure and teardown, with no surviving process.
- Replay settled and interrupted background calls.
- Add the guidance line; update the guide and AGENTS.md; add the changeset.
- Add the behavioral coverage, run the compiled checks, and exercise the preview in Sesh.

### Out of scope

- **Jobs that outlive their turn**, and agent-started turns. ACP v1 cannot show a turn the agent starts, and Mark chose turn-owned jobs.
- **OMP's service mode** (`launch`), including dev servers that keep running between turns.
- **The Mac app's Shell row**, which stays an unconnected stub. Connecting it belongs with the app's settings work that follows proposal 0007 (Beads `pico-bfk.5`).
- **A threshold setting.** Pico fixes the threshold at 60 seconds; Mark chose an on/off setting.
- **Changing OMP's tool descriptions**, its `proc://` routes, or patching OMP.

## Preview

- **Repository shape:** a local stdio executable launched by Sesh.
- **Artifact:** `.build/pico` built from this pull request, or the `.build/pico-acp` development launcher, used through the existing user-authorized Pico preview registration in Sesh. Any registration change goes through Sesh's supported UI with the human's permission.
- **Exercise:**
    1. In a disposable project, ask Pico to run a script that prints a line a second for 20 seconds, with `async`, and to end its reply. Check that the call streams the lines with its job line, that the turn stays busy, and that the agent's follow-up appears in the same turn.
    2. Ask for two background jobs and a `wait`. Check the `wait` call's progress lines and that it completes when a job ends.
    3. Run a plain command that takes 70 seconds and check it moves to the background in the same call. Run `pico settings update --auto-background off`, start a new session, and check the same command stays in the foreground.
    4. Start a long job, press Stop, and check that its call fails, `ps` shows none of its processes, and the next prompt works.
    5. Start a long job, stop Pico's agent process from Sesh, and check with `ps` that nothing it started remains. Reopen the session and check how the interrupted call is shown.
- **Cleanup:** remove the disposable project and its Pico history. Preserve the user's sessions and registrations.

## Policies and decisions checked

- **Policies:** None. `policies/` contains only its index README.
- **Decisions:** None. `decisions/` contains only its index README.
- **[VISION.md](../VISION.md)** requires visible execution with accurate progress, results, errors and cancellation. This proposal makes the currently invisible background execution visible within its call and its turn, and removes the uncancellable delivery run.
- **[Proposal 0001](0001-acp-adapter-core.md)** deferred `wait` until background jobs had an ACP representation. This proposal defines one, adds `wait` through the roster check, and extends 0001's cancellation bounds to jobs. It also corrects the gap described under Motivation, where 0001's visibility and cancellation guarantees did not hold for backgrounded commands.
- **[Proposal 0004](0004-session-restoration.md)** governs replay. This proposal keeps its shape and settles backgrounded calls from the presentation saved when their job ended.
- **[Proposal 0006](0006-todo-plan-updates.md)** is unaffected.
- **[Proposal 0007](0007-pico-owned-configuration.md)** owns Pico's settings file and commands. This proposal adds one optional version-1 member and one `settings update` option, following its registry, output, error and save rules, and Mark chose on 2026-11-02 to extend version 1 rather than define version 2. It changes one 0007 rule: `session/load` and `session/resume` now read the file for auto-background. They fall back to Pico's default when it cannot be used, so 0007's guarantee that the file never stops a reopen still holds.
- **The AGENTS.md hard rules** "Every agent-requested tool execution and delegated session is visible through ACP" and "Never add … OMP's native task, agent and workpool delegation" hold: subprocess activity stays in its call, and `wait` is admitted through async alone, with IRC and launch off.
- **"Never rewrite the user's global OMP configuration"** holds: every pin is a per-session override, and Pico reads no OMP settings.

## Future directions

- Jobs or services that outlive a turn could return if ACP gains agent-started turns, or if Sesh grows a surface for long-lived processes, such as its dev-server list.
- The job limit or the threshold could become Pico settings beside `autoBackground`.
- The Mac app's Shell row could show and change `autoBackground` once the app reads and writes Pico's settings.

## Alternatives considered

- **Jobs outlive their turn.** The turn ends with the model's reply, the job's call settles later outside any turn, and the model sees the result at the next prompt. Sesh's handling of updates outside a turn is unobserved, and stopping OMP's delivery run needs machinery the SDK does not expose; `deferAgentInitiatedTurns` did not stop it in a spike. Mark chose turn-owned jobs.
- **Interim fix first.** Pin async, auto-background and launch off on `main` now, then return them here. Mark chose to fold the fix into this proposal.
- **Auto-background from the user's OMP configuration, or pinned on or off.** Mark directed that Pico use only its own settings, with Pico's own defaults.
- **An `autoBackgroundSeconds` threshold, alone or beside the on/off member.** More to validate and test for a value nobody has asked to change. Mark chose on/off with Pico's fixed 60 seconds.
- **Settings file version 2.** Older Pico builds would report the file as written by a newer Pico, and every save would break a downgrade. Mark chose to extend version 1, which no release reads yet.
- **Reopened sessions fail on an unusable file, or record their own value.** Failing would reverse 0007's guarantee that a reopen never depends on the file; recording would keep a reopened conversation on a value the user has since changed. Mark chose to read the current file and fall back to Pico's default.
- **OMP's ACP mode as is.** Its bounded delivery drain still lets a late job start a run outside any turn the client started, and it shows the model-facing notice.
- **A separate tool call per job.** This would invent a call the model never made, against the rule that subprocess activity stays within its call.
- **Keep service mode.** Services can outlive the session and the process, and issue #27 requires launch to stay off so `wait` cannot reach anything but jobs.

## Open questions

None.

Mark settled the defect handling (fold it in), job lifetime (turn-owned) and the settings split (async pinned on, launch pinned off, auto-background from Pico's configuration) on 2026-11-02. After proposal 0007 merged, Mark settled the setting's shape (on/off, Pico default on at a fixed 60 seconds), extending settings version 1, and reopen behavior (current file, Pico's default when unusable), and directed that Pico use only its own settings.
