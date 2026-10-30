---
id: proposal.0001
title: ACP Adapter Core Turn Path
authors: [Mark Malstrom]
status: awaiting-implementation
pull-request: https://github.com/markmals/pico/pull/1
issues: []
supersedes: []
---

# ACP Adapter Core Turn Path

## Summary

Pico's first runnable program: a Bun stdio ACP agent, ported from OMP's own ACP mode onto the official ACP SDK. Sesh can launch it as a custom agent, run OMP SDK turns with a curated tool roster that has no eval, built-in LSP or native delegation, see every tool call, and cancel work. Nothing asks for approval.

## Authorization

Direct human consent from Mark Malstrom on 2026-10-30, in the Sesh session that opened this pull request. They chose:

- one proposal for the adapter first and a later one for the companion app;
- the human approves each gate (no build mandate);
- a private `markmals/pico` repository with this draft pull request;
- **the core turn path** as proposal 0001, with model and reasoning selectors, session restore, and child-session delegation left to later proposals;
- **porting OMP's ACP agent onto the official SDK**, over a fresh adapter or in-process reuse of `runAcpMode`;
- **no approval prompts at all**: Pico auto-approves every tool call;
- **in-place OAuth refresh** in the user's OMP credential store is acceptable for now; a Pico-owned store may replace it later;
- **Sesh Autonomous support** gets its own follow-up proposal built on a Pico-owned credential and state store, not this one;
- **Sesh's MCP servers only** in 0001; connecting arbitrary MCP servers configured through the companion app comes later;
- **`task` stays permanently excluded**, alongside eval and the built-in LSP. The other omitted tools are deferred, not excluded.

## Motivation

Mark uses Sesh as their main agent UI and wants to keep OMP's engine. Today they run `omp acp` behind a two-line launcher registered in Sesh. That works, but it brings OMP features that serve them badly in Sesh:

- Python/JavaScript eval cells render with shell-like presentation and the wrong syntax highlighting.
- The built-in LSP duplicates the `intellisense` CLI they prefer.
- Native `task` subagents appear as a synthetic `task` tool card with progress text ("Running agent X…") instead of real, inspectable Sesh child sessions.
- Sesh's own MCP tools sit behind a generic `write` to `xd://mcp__sesh_*` instead of appearing as named tool calls.

Nothing in the repository can run an agent yet. Every later Pico capability builds on one working path: Sesh launches Pico, Pico runs an OMP turn under Pico's policy, and every tool the agent executes shows up in Sesh with an honest status. Without that path, the selectors, restore, delegation and the companion app have nothing to configure or extend.

## Domain grounding

Grounding covered the ACP v1 specification and the installed `@agentclientprotocol/sdk` 2.1.0; the installed `@oh-my-pi/pi-coding-agent` 18.14.0 source; Sesh's documentation; and direct observation of seshd 0.25.2 running `omp acp` on this machine. Throwaway spikes checked compile and type-check feasibility. The conceptual model is small: one ACP session maps to one in-memory OMP session, and a tool call keeps the engine's identifier. A full ontology review is deferred to the restore proposal, where persistent identity first appears.

### Established context

**ACP**

- The transport is newline-delimited JSON-RPC over stdio. The agent must not write anything to stdout that is not an ACP message; logging goes to stderr ([transports](https://agentclientprotocol.com/protocol/v1/transports)).
- Protocol version is `1` (`@agentclientprotocol/sdk/dist/v1/schema/index.d.ts:33`). The agent echoes the client's version if it supports it; otherwise it answers with its latest ([initialization](https://agentclientprotocol.com/protocol/v1/initialization)).
- Every agent must handle `session/new`, `session/prompt`, `session/cancel` and `session/update`, and must accept `text` and `resource_link` prompt content. Image, audio and embedded `resource` content, HTTP and SSE MCP transports, and the load, list, resume and close session operations each require an advertised capability (`types.gen.d.ts:1400-1552`).
- `session/new` carries an absolute `cwd` and an `mcpServers` array. A stdio entry is `{name, command, args, env}` (`types.gen.d.ts:3222-3377`).
- Tool calls are reported with `tool_call` and patched with `tool_call_update`.
    - `ToolKind` is `read | edit | delete | move | search | execute | think | fetch | switch_mode | other`.
    - `ToolCallStatus` is `pending | in_progress | completed | failed`.
    - Content is `content`, `diff {path, oldText, newText}` or `terminal`.
    - `locations` are `{path, line?}` (`types.gen.d.ts:140-224, 575-597, 2423-2472`).
- `StopReason` is `end_turn | max_tokens | max_turn_requests | refusal | cancelled` (`types.gen.d.ts:2267`).
- `session/cancel` is a notification. The agent should stop model requests and tool calls, may send remaining updates, and must then answer the pending prompt with `cancelled`. An abort exception must not surface as a JSON-RPC error ([prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)).
- SDK 2.1.0 exposes only the `agent()` / `client()` app API. The class API (`AgentSideConnection`, `Agent`) was removed in 2.x (`node_modules/@agentclientprotocol/sdk/MIGRATION_STABLE_UNSTABLE.md:12-16`).
- The ACP compatibility kit, `agentclientprotocol/acp-tck`, launches an agent per test. It checks initialization, session lifecycle, prompt turns, cancellation, error handling and transport hygiene, and grades requirements by tier ([testing](https://agentclientprotocol.com/libraries/testing)).

**OMP SDK 18.14.0**

- `createAgentSession(options)` (`src/sdk.ts:1771`) accepts `toolNames` and `restrictToolNames`, `enableLsp`, `enableMCP`, `settings`, `sessionManager`, `authStorage`, `appendSystemPrompt`, `hasUI` and `autoApprove` (`src/sdk.ts:547-955`).
- Under `restrictToolNames`, MCP tools are not mounted as `xd://` devices: `xdevRequested = !restrictToolNames && …` (`src/tools/index.ts:879`). Extension-contributed tools are never exposed in a restricted session (`src/sdk.ts`, `preloadedPreparedExtensions`).
- The settings that govern the excluded features:
    - Eval is admitted only when `eval.py` or `eval.js` is true (`src/eval/settings.ts:7-30`).
    - `lsp` requires `enableLsp` and `lsp.enabled` (`src/tools/index.ts:758`).
    - `task` requires `task.maxRecursionDepth` above the current depth, so `0` removes it (`src/tools/index.ts:805`, `src/task/types.ts:304`).
    - `agent()` and `workpool()` exist only inside eval cells (`src/eval/settings.ts:48-58`).
- `Settings.loadReadOnly({cwd})` loads the user's effective configuration without writing anything. `.overlay(overrides)` creates a child whose overrides are never persisted or written back (`src/config/settings.ts:745-796`).
- Restricted sessions force on-disk MCP discovery off: `enableMCP = !restrictToolNames && (options.enableMCP ?? true)` (`src/sdk.ts:2650`). A private `MCPManager` (`./mcp` subpath) connects the given servers, and `AgentSession.refreshMCPTools()` (`src/session/agent-session.ts:7214`) mounts their tools as `mcp__<server>_<tool>` (`src/tools/builtin-names.ts:65-68`). `refreshMCPTools()` does not check `enableMCP` (`src/session/session-tools.ts:2496-2523`).
- The default system prompt wraps every tool-specific passage in a check for that tool: `{{#has tools "lsp"}}`, `"task"`, `"todo"`, `"ask"`, and `ast_grep`/`ast_edit` (`src/prompts/system/system-prompt.md:98-203`). `bash`'s description mentions eval only behind `{{#if hasEval}}` (`src/prompts/tools/bash.md:2`). The one subagent passage outside any check is the `agent://` line in the internal-URL list (`src/prompts/internal-urls/agent.md:1`, `src/internal-urls/agent-protocol.ts:152-154`).
- `appendSystemPrompt` is additive and renders last, as user instructions. The function form of `systemPrompt` receives the fully rendered default blocks and returns the final prompt (`src/sdk.ts:650-656, 4253-4259`; `src/system-prompt.ts:462-471`).
- The rendered prompt carries the OS and model. The working directory arrives in a per-turn reminder. There is no git branch or worktree information (`src/system-prompt.ts:237-242`, `src/prompts/system/date-cwd-reminder.md:1-3`).
- In a restricted session with `toolNames` set to `read, grep, glob, find, edit, write, bash, web_search` and Pico's settings overlay, the effective roster on this machine was `read, grep, glob, edit, write, bash, web_search`; `find` was not admitted (spike, 2026-10-30).
- `AgentSession.subscribe()` listeners are fire-and-forget: "`AgentSession.#emit()` does not await listeners" (`src/session/agent-session.ts:1224-1225`).
- `abort()` (`:11127`) kills a running `bash` subprocess, with a 1 s grace period before `ToolAbortError` (`src/tools/bash.ts:1371-1507`).
- `discoverAuthStorage()` opens the user's credential store at `<agentDir>/agent.db` and has no read-only mode (`src/sdk.ts:1042-1075`). Opening it needs write access: under a sandbox that denies writes to `~/.omp`, both `discoverAuthStorage()` and `createAgentSession()` fail with `Database "/Users/orion/.omp/agent/agent.db": attempt to write a readonly database` (spike under `sandbox-exec`, 2026-10-30).
- The package is MIT-licensed. Copyright holders: Mario Zechner, Can Bölük, Stencil Labs, Inc.

**Sesh, observed**

- Custom agents are registered under Settings › Machines › Add an Agent › Custom…, which records a name and an executable path only ([more agents](https://sesh.codes/docs/more-agents/); `~/Library/Application Support/Sesh/agents.json`).
- seshd runs one agent process per session. The agent receives `SESH_SESSION_ID`, `SESH_ROOT_PATH` and related variables, and a launchd-style `PATH` (seshd's own is `/usr/bin:/bin:/usr/sbin:/sbin`).
- Sesh's MCP server arrives as a stdio entry the agent spawns (`seshd mcp`). Its environment carries `SESH_MCP_URL` and the secret `SESH_MCP_TOKEN`; the agent's own environment does not.
- Sesh's MCP server offers 13 tools, which OMP names `mcp__sesh_<tool>` (tool descriptions and schemas as received by this session; [agents that start sessions](https://sesh.codes/docs/agents-that-start-sessions/)). The server also sends instructions, which OMP adds to the system prompt.
    - **Talking to the user:** `ask_user` (1–4 questions with options, previews, multi-select and typed answers; answerable from a phone; `waitFor` resumes unanswered questions), `notify` (push notification, body ≤ 200 characters, at most 5 per 10 minutes), `create_artifact` and `update_artifact` (Sesh-native component trees or a self-contained HTML page beside the chat).
    - **This session:** `session_info` (name, branch, base branch, worktree, project, running dev servers) and `rename_session`.
    - **Other sessions:** `list_projects`, `list_sessions`, `start_session` (own worktree by default; `inPlace`, `baseBranch`, `name`, `agent` defaulting to the caller's own agent, `reportBack` on by default), `send_message`, `read_session`, `wait_for_sessions` and `stop_session`.
    - Two per-machine settings gate these: **Sesh Tools for Agents** turns all of them on or off, and **Let Agents Manage Sessions** turns starting, messaging and stopping sessions on or off.
    - An agent can have at most 8 of its sessions working at once, and a session an agent started cannot start sessions of its own.
- OMP's `bash` tool still finds `~/.cargo/bin/intellisense` from that launchd environment, as this session's own tool calls showed.
- Sesh renders ACP tool calls by kind, title, absolute locations, text content and status, and shows `failed` as failed (Sesh session `events.jsonl` records).
- **Autonomous** sessions never ask the user ([approvals and Autonomous](https://sesh.codes/docs/approvals-and-autonomous/)).
    - If the agent offers a permissive mode, Sesh selects it, as with Claude's `bypassPermissions` (`~/Library/Application Support/Sesh/agent-probes.json`). Otherwise Sesh answers the agent's permission requests itself.
    - Sesh also runs the agent in a macOS sandbox. The rules embedded in `seshd` start from `(version 1) (allow default)`. Writes are allowed in the session folder, the project's git data and temporary folders, and in a fixed list of agent and cache folders: `.claude`, `.codex`, `.gemini`, `.cursor`, `.pi`, `.local/state`, `.npm`, `.cache`, `Library/Caches`, `.bun`, `.pnpm-store`, `.yarn`. The rules block reads of credential folders such as `.ssh`, `.aws`, `.gnupg`, `.config/gh` and `.netrc`. `.omp` is not on the writable list.
    - Sesh sends the agent no Autonomous flag: no `_meta`, no environment variable and no session field.
- **New Branch** (the default) runs the session in a git worktree at `~/Library/Application Support/Sesh/worktrees/<repo>-<hash>/<session-name>`, on branch `sesh/<session-name>` from the base branch ([branches and worktrees](https://sesh.codes/docs/branches-and-worktrees/)).
    - `session/new.cwd` is that worktree. `SESH_ROOT_PATH` is the main checkout, and `SESH_WORKTREE_PATH` and `SESH_BRANCH` describe the worktree ([project setup](https://sesh.codes/docs/project-setup/); `session.json` `cwd` and `projectRoot`).
    - Sesh copies `.env` files into the worktree and regenerates dependencies with the project's setup command.
    - Pushing, opening pull requests and syncing are Sesh UI actions, not agent duties.

### Relevant constraints and principles

- `AGENTS.md` requires the official ACP TypeScript SDK. It also forbids fabricated capabilities and silent fallbacks, requires every agent-requested tool execution to be visible through ACP, and forbids rewriting the user's global OMP configuration or credentials.
- `VISION.md` and `AGENTS.md` exclude eval, the built-in LSP and automatic LSP hooks, and native task/agent/workpool delegation from Pico's runtime.
- A tool belongs in the roster only after its input, progress, output, error and cancellation have a defined ACP representation (`PROTOTYPE.md`).
- `toolNames` alone is not an allowlist. The restriction must be proven against the effective roster, including MCP tools mounted after creation (`PROTOTYPE.md`).

### Quality bar

- Every executed tool produces exactly one `tool_call`, with the engine's identifier, a recognizable title and kind, its input, and a terminal status that matches what happened.
- `initialize` claims nothing that Pico does not do.
- Provider and configuration failures reach Sesh as errors with their cause, never as a quiet `end_turn`.
- Cancelling a running command stops it, ends the turn as `cancelled`, and leaves the session ready for the next prompt.
- Nothing written through `process.stdout` or the `console` by Pico, OMP, an extension or a dependency reaches the client outside the ACP stream.

### Remaining uncertainty

- **Sesh's client capabilities.** What Sesh sends in `initialize` (`fs`, `terminal`) has not been captured; seshd persists no raw JSON-RPC. This design does not depend on it, because Pico executes locally.
- **Prompts during a running turn.** Whether Sesh ever sends a second `session/prompt` while a turn is running is unknown. This design rejects one; the preview must confirm Sesh does not rely on it.
- **MCP tools under `restrictToolNames`.** Whether tools mounted by `refreshMCPTools()` pass the restriction without being named in `toolNames` is unverified. The design names them explicitly either way.
- **Sesh's exact sandbox profile.** The list above comes from strings in the `seshd` binary, and the spike approximated the profile rather than reusing it. Pico's behavior in a real Autonomous session is checked in the preview.

## Existing baseline

The closest baseline is OMP's own ACP mode, which Mark runs today (`src/modes/acp/`: `acp-agent.ts` 3255 lines, `acp-event-mapper.ts` 1129, `acp-mode.ts` 97, plus `src/session/acp-permission-gate.ts`). It is exported publicly as `@oh-my-pi/pi-coding-agent/modes/acp`.

What it gets right, and what Pico preserves:

- **Session construction is a host seam.** `AcpSessionFactory` hands every `createAgentSession` call to the host (`acp-mode.ts:17-25`). The agent drives the session only through public `AgentSession` methods.
- **Event translation is pure and avoids duplicates by construction.** Only `tool_execution_start/update/end` become tool calls; model-stream tool-call deltas are never surfaced (`acp-event-mapper.ts:188-262`). Diffs come from `result.details.perFileResults` (`:713-742`), and titles from intent, path, command or pattern (`:583-602`).
- **Host-supplied MCP servers are the authority.** It builds a private `MCPManager` from `session/new.mcpServers` only (`acp-agent.ts:3064-3137`) and translates stdio, HTTP and SSE entries (`:3143-3161`).
- **Stdout isolation.** It redirects `process.stdout` and `console.log` to stderr before the protocol starts (`acp-mode.ts:39-60`).
- **Cancellation is a barrier.** Repeated cancels are idempotent, and the session is closed if `abort()` hangs (`acp-agent.ts:1324-1372`).

What is incidental or compromised for Pico:

- **No official SDK.** It implements ACP with OMP's own pre-2.0 reimplementation (`pi-utils/src/acp.ts:1`). That API no longer exists in the official SDK, so its types cannot be used with SDK 2.1.0.
- **Static capability claims.** It always advertises image and embedded context input, HTTP and SSE MCP, `loadSession`, and list, fork, resume and close (`acp-agent.ts:838-858`), whether or not a path has been exercised.
- **Cross-project history leak.** `session/list` without a `cwd` returns every OMP session on disk across projects (`acp-agent.ts:901-916, 2651-2654`).
- **Provider errors become `end_turn`.** Rate-limit, auth and network failures map to `end_turn`, and `refusal` comes from a regex on error text (`acp-agent.ts:2025-2050`).
- **MCP tools all render as `other`.** `mapToolKind` has no MCP awareness and only a small fixed table (`acp-event-mapper.ts:154-174`).
- **Features outside this proposal:** `xd://propose` plan mode, the `_session/steering` and `_omp/*` vendor extensions, slash commands, terminal auth, elicitation dialogs, and fs/terminal client bridging.
- **No explicit notification queue.** Ordering depends on synchronous dispatch inside `subscribe` (`acp-agent.ts:1801-1845`).

Mark chose to port this code rather than write a new adapter. The port keeps the structure and the edge-case handling listed under "preserves", rewrites the protocol layer onto SDK 2.1.0, and removes or corrects everything under "compromised" that 0001 touches.

## Proposed solution

Pico's adapter is a port of OMP 18.14.0's ACP mode onto `@agentclientprotocol/sdk` 2.1.0, cut down to the core turn path, with a Pico session factory that applies the curated runtime policy:

- `Settings.loadReadOnly` overlaid with Pico's settings;
- an explicit tool allowlist under `restrictToolNames`;
- `enableLsp: false`, and no on-disk MCP discovery: only the servers Sesh sends are connected, through a private `MCPManager`;
- `autoApprove: true`;
- an in-memory session manager.

The ported event mapper keeps OMP's translation of engine events into ACP updates, with two changes. MCP tool calls get readable titles. And every update for a session passes through one ordered queue, so no update can overtake an earlier one or the turn's final response. Capability claims and stop reasons are rewritten to report only what is true.

```text
Sesh launches .build/pico-acp           → initialize: protocol 1, no optional capabilities
Sesh creates a session (cwd, seshd mcp) → OMP session with read/grep/glob/edit/write/bash/web_search + mcp__sesh_*
"add a test and run it"                 → streamed text; tool_call write (diff), tool_call bash ($ bun test …, output, completed)
user presses Stop during `sleep 60`     → bash killed, tool call failed, stopReason cancelled; next prompt runs
model key revoked                       → session/prompt fails with the provider's error message
```

## Detailed design

### Executable and process

- The adapter source lives in `adapter/`, with tests beside the modules. The entry point is `adapter/main.ts`.
- `mise run acp:launcher` runs a zero-dependency TypeScript tool that writes `.build/pico-acp`: an executable file whose shebang is the absolute path of the pinned Bun and which imports `<repository>/adapter/main.ts`. `.build/` is gitignored. The launcher needs no `PATH` entry, so it works when seshd launches it with launchd's environment.
- Before any OMP module loads, `adapter/main.ts` redirects `process.stdout` writes and every `console` method that writes to stdout (`log`, `info`, `debug`, `table`, `dir`, `trace`, `group`, timers, counters and the like) to stderr, and keeps the original fd 1 handle for the ACP stream only. Output written that way by an OMP module, an extension or a dependency appears on stderr and never in the protocol stream. Writes straight to file descriptor 1 (`fs.writeSync(1, …)`, `Bun.write(Bun.stdout, …)`) and child processes that inherit stdout cannot be intercepted inside the process; OMP's own tools capture their subprocesses' output, and no OMP code path writing to fd 1 directly is reachable from Pico.
- Diagnostics go to stderr. Pico never logs MCP server `env` values or `headers`, credentials, or the contents of prompts or tool results.
- Pico supports any number of sessions on one connection, each independent.
- When stdin closes, or on SIGTERM or SIGINT, Pico:
    1. aborts active turns;
    2. closes each session's MCP connections, which terminates the spawned `seshd mcp` processes;
    3. disposes the OMP sessions;
    4. exits with status 0.

    If cleanup has not finished within 5 seconds, Pico exits with status 1 and logs which step was outstanding.

- Pico writes nothing to the user's OMP configuration, session directories or Sesh files, and creates no session files.

### `initialize`

- If the client requests protocol version 1 or later, Pico answers `protocolVersion: 1`.
- `agentCapabilities` is `{ loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false } }`. There is no `sessionCapabilities`.
- `agentInfo` is `{ name: "pico", title: "Pico", version }`, where `version` comes from `package.json`. `authMethods` is `[]`.
- Pico registers no handler for `session/load`, `session/list`, `session/resume`, `session/close`, `session/set_mode`, `session/set_config_option` or `authenticate`, so the SDK answers each with method-not-found. Pico sends no `available_commands_update` and no vendor `_meta` extensions.

### `session/new`

- `cwd` must be an absolute path to an existing directory. Otherwise the request fails with an invalid-params error naming the problem.
- Each stdio entry in `mcpServers` is connected through a private `MCPManager` with the entry's `command`, `args` and `env`. The `env` values reach the server exactly as sent, with no shell or variable expansion.
    - An HTTP or SSE entry fails the request with an invalid-params error naming the server and stating that only stdio MCP servers are supported.
    - Two entries with the same name fail the request with an error naming the duplicate.
    - If a stdio server fails to connect or list its tools, or has not listed them within 30 seconds, the request fails with an error naming the server and the cause. No session is created, no partial tool set is used, and servers already started are stopped.
- Pico creates the OMP session with:
    - `settings`: `Settings.loadReadOnly({ cwd })` overlaid with `eval.py: false`, `eval.js: false`, `lsp.enabled: false`, `task.maxRecursionDepth: 0`, `tools.approvalMode: yolo`, every configured per-tool approval policy (`tools.approval`) set to allow, and no restricted folders (`tools.restrictedFolders`);
    - `enableLsp: false`, `enableMCP: false` (restricted sessions force this anyway), `hasUI: false`, `autoApprove: true`;
    - `restrictToolNames: true`, and `toolNames` set to the built-in roster plus the name of every tool the connected MCP servers supplied (see Effective roster);
    - `sessionManager`: an in-memory session manager for `cwd`;
    - `authStorage`: the user's OMP credential store from `discoverAuthStorage()`;
    - `appendSystemPrompt` and a `systemPrompt` function: Pico's guidance (see Agent guidance).

    The connected MCP tools are mounted with `refreshMCPTools()` before the response is sent.

- The model and thinking level are whatever the user's OMP configuration resolves for `cwd`. The request fails with an error that says so when no model resolves, when the configured model is unavailable and OMP would fall back to another one, or when the model's credentials cannot be resolved; Pico does not substitute another model.
- If the credential store cannot be opened, the request fails with an error naming the store's path and the cause. When the cause is a read-only or permission-denied failure, the message also says that Sesh's Autonomous sandbox blocks writes to `~/.omp` and that Pico does not support Autonomous sessions yet.
- The response is `{ sessionId }`, with no `modes` and no `configOptions`. `sessionId` is unique within the process.
- User and project extension hooks keep working. Restricted sessions skip OMP's own extension discovery (`src/sdk.ts:2831-2842`), so Pico discovers the same user and project extensions itself and passes them to the session preloaded, loading each module once under OMP's host guard. An extension that fails to load is skipped, the session still starts, and the failure is written to stderr naming the extension. Hooks run, and extension tools are not exposed (`restrictToolNames`; `src/sdk.ts:3618, 3711`).

### Sesh worktrees

- `session/new.cwd` is the only source of the working directory. When Sesh runs the session in a New Branch worktree, `cwd` is that worktree, and Pico reads project settings, extensions and AGENTS.md from there.
- Pico ignores `SESH_ROOT_PATH`, which points at the main checkout. Pico does nothing else differently in a worktree; pushing, pull requests and syncing stay with Sesh.

### Effective roster

- The built-in roster is `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`. On top of that come the tools the session's host MCP servers supply, named `mcp__<server>_<tool>` (for Sesh: `mcp__sesh_ask_user`, `mcp__sesh_create_artifact`, `mcp__sesh_notify`, `mcp__sesh_start_session` and the rest Sesh offers).
- **Replaced by Sesh's tools:** OMP's `ask` by `mcp__sesh_ask_user`. Native delegation (`task`, the eval-only `agent()` and `workpool()` helpers, and vibe mode's `vibe_spawn`, `vibe_send`, `vibe_wait`, `vibe_kill` and `vibe_list`) by Sesh's session tools. These are permanently excluded.
- **Permanently excluded:** `eval` and `lsp`, and the delegation tools above. Pico's settings overlay disables `eval`, `lsp` and `task`, as well as leaving them off the allowlist. The `vibe_*` tools exist only in vibe mode and are kept out by the allowlist.
- **Deferred, not excluded:** `find` (semantic code search), `todo`, `wait` (Sesh's `wait_for_sessions` covers waiting on sessions, but not OMP's background `bash` jobs), `ast_grep`, `ast_edit`, `checkpoint`, `rewind`, `debug`, the memory tools, and extension-contributed tools. Each comes back through its own change once it has a defined ACP representation. Until then the model never receives their schemas. Hidden tools are excluded, and no `xd://` device routes exist for any tool.
- Sesh tools exist only when Sesh supplies them. If a machine turns Sesh's tools off, the session has none of them, and Pico substitutes nothing.
- After MCP tools are mounted, Pico compares the session's active tools with the allowlist. If any tool outside the allowlist is active, `session/new` fails with an error naming it, and no session is created. An allowlisted built-in the engine does not admit (as with `find` in OMP 18.14.0) is simply absent.
- If the model emits a call to a tool outside the roster, the engine emits `tool_execution_start` and then rejects the call as `Tool <name> not found` (`pi-agent-core/src/agent-loop.ts:3567-3601`). That attempted call is reported as a `failed` tool call like any other failed execution, and nothing runs.
- LSP diagnostics, format-on-write and LSP startup never happen, because `enableLsp: false` and `lsp.enabled: false` disable the subsystem.

### Agent guidance

- `appendSystemPrompt` adds a short Pico-owned section with positive guidance only. Code intelligence comes from running the `intellisense` CLI through `bash`. Structured questions, artifacts and notifications go through the `mcp__sesh_*` tools. Sesh may run the session in its own git worktree and branch, and `mcp__sesh_session_info` reports which. The section names no excluded tool.
- OMP's prompt already leaves out guidance for absent tools. The one exception is the `agent://` line in the internal-URL list, which describes subagent output. Pico's `systemPrompt` function returns the default blocks with that line removed and nothing else changed.
- User-owned AGENTS.md files, rules and skills load unchanged; Pico never edits them.

### `session/prompt`

- `text` blocks pass to the engine as text, in order.
- A `resource_link` block becomes a text reference in the same user message, containing the link's `name` and `uri`, plus `title` and `description` when present. Pico does not fetch the resource.
- A prompt containing an `image`, `audio` or `resource` block fails with an invalid-params error naming the unsupported block type. Nothing reaches the model.
- A `session/prompt` for an unknown session fails with an invalid-params error. A `session/prompt` received while another turn in the same session is running fails with an error stating that a turn is already running; the running turn is unaffected.
- Every `session/update` for a session goes through a per-session FIFO queue, in the order the engine emitted the events. The `session/prompt` response is sent only after every update for that turn has been written.
- Assistant text deltas become `agent_message_chunk` and thinking deltas become `agent_thought_chunk`.
- Stop reasons:
    - The turn completes normally: `end_turn`.
    - A `session/cancel` arrived during the turn: `cancelled`, even if aborting produced engine errors.
    - The final assistant message stopped for length: `max_tokens`.
    - The engine reports an explicit refusal stop reason: `refusal`. Text matching is never used.
- Any other engine or provider failure (authentication, rate limit, network, unavailable model, an assistant message that ends in error) fails `session/prompt` with a JSON-RPC internal error whose message is the engine's error message. Updates already sent stay sent.

### Tool calls

- When the engine emits `tool_execution_start`, Pico sends one `tool_call`. Its `toolCallId` is the engine's tool call ID, `name` is the engine's tool name, `status` is `in_progress`, `rawInput` is the arguments, and `title`, `kind` and `locations` are as below. Nothing else creates tool calls.
- Kinds: `read` → `read`; `grep` and `glob` → `search`; `edit` and `write` → `edit`; `bash` → `execute`; `web_search` → `fetch`; any `mcp__*` tool → `other`.
- Titles, in order of preference:
    - `bash` is titled with its command.
    - Otherwise, the call's intent when present.
    - Otherwise, its first path, pattern or query argument.
    - Otherwise, for `mcp__<server>_<tool>`, `<server>: <tool>` (such as `sesh: ask_user`).
    - Otherwise, the tool's name.
- `locations` holds absolute paths, resolved against the session `cwd`:
    - `read`: the file, with the path's line selector removed. When the selector names a starting line (`file.ts:50`, `file.ts:50-80`, `file.ts:50+30`), `line` is that line.
    - `write`: the file, on the `tool_call`.
    - `edit`: every affected file, on the final `tool_call_update`, because `edit`'s arguments name the file only inside its patch text.
    - `grep` and `glob`: the searched path when given.
- `tool_execution_update` with partial output becomes a `tool_call_update` whose `content` is the current output as text. For `bash`, that is the combined output so far.
- `tool_execution_end` becomes a `tool_call_update` with:
    - `status`: `failed` when the result is an error, otherwise `completed`;
    - `rawOutput`: the result details;
    - `content`:
        - for a successful `edit` or `write`, a `diff` per affected file, with the absolute `path`, `oldText` (`null` for a newly created file) and `newText`;
        - for every other result, including failures, the result's text as returned to the model.
- Every tool executes locally in the Pico process and its subprocesses. Pico does not use the client's `fs/*` or `terminal/*` methods, even when the client advertises them.

### Approvals

- Pico never sends `session/request_permission`. Every admitted tool call runs without asking: OMP's session runs with `autoApprove: true`, and Pico installs no permission gate.
- The user's OMP approval configuration has no effect inside Pico: not its approval mode, not its per-tool approval policies (`tools.approval`), whether they ask or deny, and not its restricted folders (`tools.restrictedFolders`), which would otherwise turn calls touching them into prompts that cannot be answered. Pico's settings overlay neutralizes all three.
- Pico offers Sesh no mode option, so Sesh has no permissive mode to select in an Autonomous session. That does not matter for approvals, since Pico never asks. Autonomous sessions fail at `session/new` for the credential-store reason above.

### `session/cancel`

- For a session with a running turn, Pico calls `abort()` on the engine session. A running `bash` subprocess is terminated, with the engine's 1 s grace period.
- Every tool call in the turn that has not reached `completed` or `failed` gets a final `tool_call_update` with `status: failed` and the text `Cancelled`. The prompt then resolves `cancelled`.
- Repeated cancels during the same turn are ignored once the first is in progress. A cancel for an unknown session, or a session with no running turn, is ignored.
- If `abort()` has not settled within 5 seconds, Pico resolves the prompt `cancelled`, disposes the engine session and its MCP connections, and logs the failure to stderr. Later prompts to that session fail with an error stating that the session was closed after a cancellation could not stop it.
- After a cancellation that settles, the next `session/prompt` in the session runs normally. Its conversation includes the cancelled turn's messages up to the point of cancellation.

### Port and attribution

- Pico's adapter modules are derived from OMP 18.14.0's `src/modes/acp/acp-agent.ts`, `acp-event-mapper.ts` and `acp-mode.ts`.
- Each derived file begins with a comment naming its source file and OMP version. OMP's MIT license text, with its copyright lines, is kept in `THIRD-PARTY-NOTICES.md` at the repository root.
- Code for features outside this proposal is not carried over: load/list/resume/fork/close, config options and modes, plan mode, steering, slash commands, terminal auth, elicitation, the permission gate, and client fs/terminal bridging.

### Tasks and verification

- `mise run test` also runs the tests under `./adapter`.
- `mise run acp:smoke` drives `.build/pico-acp` as a subprocess through the SDK's `client()` in a temporary directory, using the user's OMP credentials and default model. It checks that:
    - stdout carries only valid ACP messages;
    - a prompt produces streamed text plus `write`, `read` and `bash` tool calls with the shapes above;
    - a failing `bash` command is reported `failed`;
    - cancelling during a long-running `bash` command kills it and returns `cancelled`;
    - a following prompt completes.
- `mise run acp:tck` runs the ACP compatibility kit at a pinned commit against `.build/pico-acp`.

## Compatibility

There are no existing users, callers, stored data or configuration to migrate. The user's terminal OMP, its configuration, its sessions and the existing `Oh My Pi` Sesh agent are untouched. Pico is registered as a separate custom agent and can be removed in Sesh at any time.

Two behaviors differ deliberately from the `omp acp` agent it sits beside:

- **No approvals.** It never asks for approval.
- **No restore.** Sessions cannot be restored after the process exits, because nothing is persisted until the restore proposal.

## Implications on adoption

- The human registers `.build/pico-acp` in Sesh by hand (Settings › Machines › Add an Agent › Custom…). Pico does not register itself.
- The launcher depends on the repository checkout and the mise-pinned Bun staying where they are.
- Pico uses the user's existing OMP credentials and default model. A machine without a working terminal OMP configuration gets a clear `session/new` error.
- `mise run acp:tck` needs `uv` and network access on first run.
- Adoption is reversed by removing the custom agent in Sesh and deleting `.build/`.

## Scope

- The `adapter/` port: stdio entry and stdout isolation, `initialize`, `session/new` with the curated session factory and Sesh MCP connection, `session/prompt` with streaming and the notification queue, tool-call translation, `session/cancel`, and shutdown.
- `THIRD-PARTY-NOTICES.md` with OMP's MIT notice.
- The `acp:launcher`, `acp:smoke` and `acp:tck` mise tasks, the `.build/` ignore entry, and `./adapter` in `mise run test`.
- Behavioral tests for the Detailed design, using OMP's `createMockModel` (`@oh-my-pi/pi-ai`) for deterministic turns.
- A guide, `guides/running-pico-in-sesh.md`, written from this proposal: building the launcher, registering it in Sesh, what the roster contains and excludes, what "no approvals" means, New Branch sessions, and why Autonomous sessions do not work yet.

### Out of scope

- **Model and reasoning selectors, and session load, list and resume.** These are the next proposal; they need config options and persistent session identity.
- **Delegation workflow guidance and verification for Sesh child sessions.** This is proposal 0003. The `mcp__sesh_*` session tools are present in 0001 because Sesh supplies them, but the delegation workflow is not designed or verified here.
- **Approval prompts and remembered decisions.** Mark chose to auto-approve everything.
- **Sesh Autonomous sessions.** These need a Pico-owned credential and state store in a folder the sandbox allows, which is its own follow-up proposal. Until then, 0001 fails such sessions with an explanatory error.
- **MCP servers beyond the ones Sesh sends.** Connecting arbitrary servers, configured through the companion app, comes later.
- **Image, audio and embedded-resource prompts, and HTTP/SSE MCP.** These need an exercised path before they can be claimed.
- **Returning the deferred tools, slash commands, modes and the steering extension.** Each needs a defined, exercised ACP representation first.
- **Client `fs/*` and `terminal/*` bridging.** Sesh's support is unverified, and local execution keeps cancellation under Pico's control.
- **The companion app, bundled runtime, compiled binary and GUI registration.** These belong to the app proposal. `bun build --compile` currently fails to embed OMP's native addon (spike, 2026-10-30).
- **The comparison against the existing OMP/Sesh setup** (brief criterion 12). It needs the full adapter.

## Preview

- Artifact: the installable executable `.build/pico-acp`, produced by `mise run acp:launcher` on this branch.
- Access: Mark registers it in Sesh as a custom agent named "Pico (dev)". In a disposable project, they start a session and:
    - ask for a small change that writes, reads and runs a command;
    - trigger a failing command;
    - press Stop during a long-running command, then send another prompt;
    - ask the agent to use `intellisense`, ask them a structured question, create an artifact and send a notification;
    - confirm that no eval, LSP or `task` tool appears and that nothing asks for approval;
    - confirm the session worked in a New Branch worktree (Sesh's default);
    - start one Autonomous session and confirm that it fails at creation with the credential-store error, not by hanging or partially working.
- Reason: Pico is a CLI-shaped stdio executable, and the only realistic exercise is a real Sesh session driving it. No cheaper artifact shows Sesh's rendering.
- Cleanup: remove "Pico (dev)" from Sesh's agents and delete `.build/`.

## Policies and decisions checked

- `policies/` and `decisions/` contain only their READMEs; no records apply.
- `VISION.md`, Minimum viable product, says "Permissions, cancellation, and session restoration must work through that same interaction surface." This proposal removes permissions by Mark's decision. If it is accepted, the vision update in Phase 5 records that Pico auto-approves.
- `PROTOTYPE.md` (brief, not a governing record) is changed in two places by the same decision: acceptance criterion 5 and the "permission requests" bullet under ACP session and execution behavior. Cancellation remains in scope.
- `AGENTS.md` platform rules:
    - **Official ACP SDK:** the port targets `@agentclientprotocol/sdk` 2.1.0.
    - **No fabricated capabilities:** `initialize` claims only the baseline.
    - **No silent fallback:** provider, MCP and model failures reach the client as errors.
    - **Visible execution:** every executed tool is a tool call.
    - **Excluded features:** no eval, LSP or native delegation, with roster verification.
    - **User configuration:** Pico reads the user's OMP settings read-only and writes no configuration. It uses the user's credential store in place, so an OAuth refresh updates it exactly as terminal OMP would; Mark accepted this on 2026-10-30.
    - **Sesh registration:** the human registers Pico through Sesh's GUI.

## Future directions

- Config options for model and thinking level, plus session persistence in a Pico-owned directory, with `session/load` replay (the next proposal).
- Delegation guidance and verification for Sesh child sessions that run Pico (proposal 0003). Sesh's MCP instructions and `start_session` description tell agents to prefer their own subagents for research; Pico has none, so its own guidance needs to say how research and quick changes are done instead.
- Returning the deferred tools (`find`, `todo` as ACP `plan` updates, `wait` with background `bash` jobs, `ast_grep`, `ast_edit`, `checkpoint`, `rewind`, `debug`, memory tools) once their ACP representation is defined.
- A Pico-owned credential and state store in a folder Sesh's sandbox allows (such as `~/.local/state/pico`), which would make Autonomous sessions work and remove in-place refresh of the user's OMP credentials.
- Arbitrary MCP servers configured through the companion app.
- Client terminal bridging, if Sesh's `terminal/*` rendering proves better than text output.

## Alternatives considered

- **A new adapter on the official SDK, using OMP's ACP mode only as a reference.** This was the agent's recommendation: less carried-over code, and every line written for Pico's policy. Mark chose the port to keep OMP's tested edge-case handling and structure.
- **Reusing OMP's `runAcpMode` in-process with a Pico session factory.** It needs the least code, but it uses OMP's own ACP reimplementation instead of the official SDK. It always advertises image, HTTP/SSE MCP, fork, resume, list and close; leaks cross-project session history; and reports provider errors as `end_turn`. Fixing those means intercepting its protocol stream.
- **Launching `omp acp` as a subprocess with environment flags** (`PI_PY=false PI_JS=false omp acp --no-lsp`). The brief excludes nesting OMP's CLI. It cannot restrict the roster, rename MCP tools out of `xd://`, or remove native delegation.
- **Keeping approvals** (OMP's gate on `bash` and `edit`, optionally plus `write`). Declined by Mark in favor of auto-approving everything.

## Open questions

None.

## Acknowledgments

The adapter is derived from Oh My Pi's ACP mode, by Mario Zechner, Can Bölük and Stencil Labs, Inc., under the MIT license.
