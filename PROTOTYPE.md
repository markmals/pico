# Pico prototype brief

Pico combines a Bun/TypeScript ACP agent backed by the Oh My Pi (OMP) SDK with a native macOS app for configuring it. Sesh remains the conversation UI; the companion app makes harness setup and configuration possible without using a terminal.

## Status and scope of this handoff

This repository contains the prototype brief, development tooling, and native macOS project metadata. The ACP adapter and companion app screens are not implemented yet. The requirements below describe the prototype to build in a separate session; they are not claims about current behavior. Native project generation and build-settings inspection validate configuration only, not a runnable app.

This preparation work covers the brief, development tooling, native app project configuration, and local commits. It does not authorize publishing a package, pushing commits, registering or changing the user's active Sesh agent, or modifying user-global credentials. A later implementation session should use this brief as its starting context and keep its implementation evidence separate from this preparation evidence.

The template's Workbench development process and Beads work tracker remain in place. Adapting the application stack does not authorize removing or redesigning that workflow. This document is an implementation brief, not an approved Workbench proposal; use it as input to the normal proposal and approval process before implementing the adapter.

## Problem

The user uses Sesh as their primary agent UI and wants to retain OMP's engine. OMP's Python/JavaScript execution blocks currently appear in Sesh with shell-like presentation and incorrect syntax highlighting. The user would rather try removing those execution tools than build a renderer for them. Executed tools must remain visible in the conversation; hiding execution is not an acceptable workaround.

The user also has a global `intellisense` CLI with preferred agent-oriented commands and configuration. Built-in OMP LSP support is redundant. Sesh child sessions have a useful visible UI that native OMP subagents do not provide, so the prototype should use Sesh as its delegation backend.

ACP can carry generic tool calls and code text. It does not by itself supply a dedicated Python/JavaScript kernel UI or guarantee a client's syntax-highlighting behavior. The goal is a supported Sesh workflow, rather than exposing every OMP feature or claiming complete support for every ACP option.

## Runtime decisions

| Area | Prototype policy |
| --- | --- |
| Agent engine | Embed the public OMP SDK directly in Bun. Do not nest `omp --mode rpc` or `omp acp` behind it. |
| Protocol | Use the official ACP TypeScript SDK and the protocol version actually negotiated with Sesh. Start with the observed v1 connection. |
| Python/JavaScript eval | Disable both eval backends and omit the eval tool, its helpers, and its commands. |
| Built-in LSP | Disable the integration, server startup, formatting hooks, and automatic diagnostics. Use the external `intellisense` CLI through visible execution tools. |
| Delegation | Disable native OMP task/subagent execution and eval-based agent/workpool spawning. Use real Sesh child sessions through its supplied MCP tools. |
| Sesh interaction | Preserve Sesh's MCP tools for questions, notifications, artifacts, and session management. Expose recognizable named tool calls. |
| Tool discovery | Build an explicit supported roster. Avoid the generic `read`/`write` to `xd://` indirection for exposed tools. |
| Configuration | Persist intentional changes in Pico-owned configuration and apply them as process/session-local policy over the user's normal OMP configuration. Reuse existing credentials without silently copying or rewriting them. |
| Product surface | A native SwiftUI/AppKit configuration app and a local stdio ACP executable launched by seshd. Sesh remains the conversation UI. No separate web frontend, database, or network service. |
| End-user setup | Homebrew is the install path: `brew install markmals/tap/pico` installs the `pico` executable, which carries its runtime and engine assets in one file ([proposal 0002](proposals/0002-pico-homebrew-distribution.md)). Installed pieces may rely on Homebrew-provided locations such as `/opt/homebrew/bin`. No global Bun/Node/OMP installation, shell PATH edits, or hand-edited config files. |

## Architecture and ownership

```text
Pico native Mac app --> Pico-owned settings + credential references
        |
        +--> local helper for provider/catalog/auth/config operations

Sesh UI <-> seshd <-> Pico ACP executable (Bun)
                          |             |
                          |             +--> Sesh-supplied MCP servers
                          +----------------> OMP SDK sessions
```

Sesh owns the conversation UI, session hierarchy, workspaces/worktrees, and human-facing approvals. OMP owns provider communication, model context, and execution of permitted tools. Pico's adapter owns capability negotiation, effective tool policy, event translation, session identity mapping, permissions wiring, and lifecycle cleanup. The native app owns GUI setup, Pico configuration, credential-selection controls, runtime readiness, and the supported GUI handoff to Sesh.

Prefer public OMP SDK exports and the official ACP types. Inspect OMP's existing ACP implementation as a baseline for lifecycle and mapping behavior. If a required approval, MCP, or UI hook is missing from the public SDK, establish the exact gap and the smallest necessary upstream change before introducing an internal dependency. Do not claim a hook exists because an internal OMP frontend uses it.

Pin exact tested package versions and commit the Bun lockfile. Keep protocol and engine responsibilities separate without building a generic framework or supporting multiple engines.

Bun is the repository's only JavaScript/TypeScript runtime and test runner, including Workbench tooling and skill helpers. Do not add a Node installation requirement. Bun-supported `node:*` APIs may remain; execute package CLIs through Bun rather than relying on their shebangs to choose a system runtime.

## Native macOS configuration app

### User outcome and delivery

An end user can open Pico, connect an account, choose a model and supported reasoning level, review the curated tool policy, connect it to Sesh, and change settings later without opening Terminal or editing JSON/YAML. Developer build and verification commands remain CLI-based through mise; they are not end-user prerequisites.

Use a native SwiftUI/AppKit app, with a macOS-only Tuist target following the repository's Apple template conventions. The initial deployment target is macOS 14; compatibility of the packaged Bun runtime, OMP native dependencies, and authentication paths on older supported systems still requires verification. Local project generation is unsigned. Distribution signing, notarization, and packaging must be established before describing a downloadable build as ready.

The delivered app installs through Homebrew, with the `pico` executable, and may rely on Homebrew-provided locations ([proposal 0002](proposals/0002-pico-homebrew-distribution.md)). It must not depend on a login shell, mise, npm, a global `omp`, or an existing Bun installation. Verify GUI-launched environments. Do not modify shell profiles to make the app work.

The app supplies the actual absolute helper launch location through a supported Sesh setup flow. Use a documented registration API if one exists; otherwise guide the user through Sesh's Custom Agent GUI with a file picker/Finder reveal and ready-to-use launch details. Do not invent a private registration endpoint or silently edit Sesh's files. Updates and app relocation must not leave Sesh pointing to a removed helper, and existing sessions must not lose their running engine when the settings app quits or updates.

### Visual and interaction references

Use macOS System Settings as the layout and visual reference: a native split-view sidebar, clear selected destination, titled detail pane, grouped forms, restrained SF Symbols, system typography/materials, and standard controls. Support keyboard navigation, Command-Comma, VoiceOver, Light/Dark appearances, Increase Contrast, and Reduce Motion. Keep explanatory copy near the setting it explains, preserve selection and scroll behavior, and avoid a web-dashboard/card-grid treatment.

Use CodexBar's provider configuration organization as the AI-settings reference: a discoverable provider list, enabled/configured states, account/credential-source selection, provider-specific detail rows, and clear connection/authentication feedback. Search should help with real provider and model catalogs; filtering a list must not rewrite saved provider configuration. Borrow the configuration workflow rather than quota dashboards, menu-bar behavior, browser-cookie extraction, branding, or the storage of raw API keys in JSON.

Proposed navigation groups:

| Pane | Configuration job |
| --- | --- |
| General | Show runtime readiness, installed app/engine versions, and the selected configuration location. |
| Providers & Accounts | Enable supported providers, reuse an existing OMP account by explicit choice, add supported API-key/OAuth/device-flow credentials, and show connection state. |
| Models | Choose the default available model and supported reasoning level from the actual engine catalog; identify provider/account requirements and unavailable selections. |
| Tools & Integrations | Explain the curated profile, choose/check the external `intellisense` executable through GUI controls, and expose only genuinely supported editable settings. Eval, built-in LSP, and native OMP delegation remain excluded. |
| Sesh | Show helper launch details and connection/setup state, then perform the supported GUI registration or handoff. |
| Diagnostics & About | Show actionable errors, redacted diagnostics, versions, and support references. |

These panes describe intended behavior, not permission to ship decorative controls. A setting appears only when it changes a real supported capability. Disabled profile features can be explained read-only; do not add switches that silently restore them. Missing programs, unauthenticated accounts, expired credentials, pending/cancelled sign-in, unsupported models, invalid settings, and failed saves need visible states with useful GUI recovery.

### Configuration and credentials

Use one versioned Pico configuration contract that the native app and ACP helper both understand. Store non-secret settings in a Pico-owned location under Application Support; keep secret material out of ordinary preferences, project files, exports, and logs. Apply validated writes atomically and preserve the previous valid configuration on failure. Keep application defaults distinct from a Sesh session's model/reasoning choices: an explicit session choice wins for that session, and changing app defaults affects new sessions unless the user explicitly applies a supported live change.

Reuse public OMP SDK APIs for provider discovery, model catalogs, credential lookup, OAuth/device-flow work, and configuration validation. Swift must not acquire a second provider integration engine or launch the OMP TUI for sign-in. Credential reuse/import must be an explicit GUI choice. Disconnecting a Pico reference must not silently revoke an account used by terminal OMP. Use Keychain or an appropriate public SDK credential store for Pico-managed secrets; prove the helper can use that storage rather than assuming a cross-runtime bridge exists.

The native app may invoke an app-managed helper through a dedicated local process channel for catalog/auth/config operations. Keep that protocol separate from ACP stdout, validate inputs at the boundary, and make cancellation/error handling reach the GUI. GUI-initiated configuration/auth work is distinct from agent-requested execution in a conversation. No always-on HTTP service or private Sesh API is required by this design.

Do not display guessed model prices, quota values, or availability. Show only data the selected engine/provider actually supplies. If a required GUI authentication or credential-store hook is absent from the public SDK, identify the precise gap before promising that provider's end-to-end setup.

## Tool policy and visibility

Start with ordinary file reads, writes, edits, file search, shell execution, and web search where the host can present them accurately. A tool belongs in the roster only after its input, progress, output, error, and cancellation have a defined ACP representation. Retain planning/progress tools only when their state can be represented correctly. Expose model and reasoning selectors that actually work; advertise other modes and commands only after their full workflow works in Sesh.

Every dispatched agent tool must produce an identifiable ACP tool call. Preserve its ID, actual tool name, intent/title, input, progress, final status, and relevant output. Supply affected absolute paths and diffs where appropriate. Avoid duplicate tool calls when both model-stream and execution events describe the same operation. Keep execution content distinct from assistant prose.

Disabling a feature means removing its tool schema, mounted routes, runtime admission, generated instructions, helper catalog entries, and slash commands. An extension or an indirect dispatch path must not quietly restore eval, built-in LSP, or native delegation. Check the final effective roster after discovery and MCP connection, including sessions reopened from history.

OMP's `toolNames` option alone is not an allowlist. The SDK documents `restrictToolNames: true` and separate opt-in for restricted custom tools. Use the actual installed API, and prove that required Sesh tools survive the restriction while excluded tools remain unavailable.

Removing eval gives up persistent Python/JavaScript variables, programmatic tool batching, eval-defined tools, and eval-based agent/workpool helpers. Some browser or orchestration helpers may depend on eval; audit those dependencies rather than leaving broken instructions. Bun remains Pico's runtime. Ordinary Python or Bun commands invoked through the visible shell tool remain possible; disabling eval is a workflow choice, not a language-execution sandbox.

Set `enableLsp: false` and the relevant effective settings rather than merely removing the LSP schema. Removing automatic OMP diagnostics means the agent must explicitly use `intellisense` or project checks when needed. Do not silently rewrite user-owned global rules or skills that refer to removed tools; identify conflicting instructions and adapt Pico-owned guidance.

## Sesh MCP integration

Accept the MCP server configuration supplied during ACP session creation or restoration. Use the session's host-provided configuration as the authority, consistent with OMP's existing ACP behavior. Do not automatically load another copy of the user's on-disk MCP setup and duplicate tools or session tokens.

Expose Sesh operations as named tools with meaningful ACP metadata, rather than a generic write to an internal device URI. OMP's `tools.xdev` setting controls this indirection. Direct tools cost more model-facing schema context; accept that cost for the selected roster and clearer execution stream.

Use Sesh's question tool for structured human questions and its artifact and notification tools for their respective surfaces. Keep approval requests distinct from questions. Preserve tool validation, cancellation, and visible failures. If a required Sesh tool is unavailable, report that limitation explicitly; never fall back to hidden native delegation or a different interaction channel while claiming the Sesh workflow succeeded.

Never log credentials, session tokens, or populated environment values. Do not make tool names or agent-authored titles an authorization boundary.

## Delegation through child sessions

Use Sesh's existing start, message, read, wait, and stop operations directly before inventing a replacement task API. A delegated worker must be a real child session visible in Sesh. Select the same registered Pico agent so the child receives the curated runtime policy; verify that inheritance rather than assuming it.

Send each child a bounded task, its required context, expected output, and verification requirements. A child does not inherit the parent's conversation. Completion, failure, and requests for user input must travel through Sesh's result/reporting mechanism. The parent must distinguish successful completion from a child waiting for the user, a failed child, or a stopped turn. Avoid polling when the host provides report-back and wait operations.

Use Sesh's default separate worktree/branch behavior for the prototype's implementation children. Native OMP subagents can share the parent's checkout; Sesh children are not drop-in replacements for that behavior. A child working from a committed branch does not automatically see the parent's uncommitted changes. Provide required context explicitly and integrate child changes as a deliberate parent action. Do not imply that child edits already exist in the parent checkout or automatically merge them.

Do not use in-place editing children to emulate shared native workers. An in-place read-only research worker requires an enforceably read-only launch profile; a prompt requesting read-only behavior is insufficient. Until such a profile exists, use the default separate child workspace or do the research in the parent.

The current Sesh documentation describes at most eight working children per parent and no child-created grandchildren. Respect actual host limits. Native OMP specialist roles, per-role models, and nested delegation do not automatically survive this cutover; use only launch options the host really exposes. Reproducing the entire OMP role system is outside this prototype.

Stopping the parent turn and stopping a child are distinct operations. Preserve Sesh's independently visible child lifecycle, make any still-running children apparent, and stop them through Sesh when requested. Do not report the overall assignment complete while required child work remains unresolved. Children cannot answer each other's or the parent's approvals.

## ACP session and execution behavior

- Keep stdout exclusively for ACP protocol messages. Route diagnostics and dependency/extension console output away from the protocol stream.
- Negotiate capabilities and reject unsupported requests clearly. Absence of a client capability means unsupported; some presentation behavior also needs an actual Sesh check.
- Support text and required baseline context/resource-link inputs. Advertise images or richer content only when the full selected model/SDK/host path supports them.
- Preserve prompt ordering, tool-call identity, final output delivery, and turn completion across asynchronous engine events. OMP event listeners are notifications, not an awaited backpressure mechanism.
- Make permission requests before the operation they authorize. Enforce rejection and cancellation, and keep any remembered decision within its stated scope. Preserve explicit Sesh Autonomous behavior without silently enabling approval bypass.
- Cancel active work, pending approvals, and owned subprocess activity correctly. Resolve the protocol turn and permit a subsequent prompt without an orphaned execution or permanently busy session.
- Reuse OMP persistence with stable Pico-to-engine session identity mapping. Resume the correct context after process restart and replay history without duplicated messages or tool results. Keep unrelated terminal OMP sessions out of Pico's advertised history.
- Advertise optional list, fork, close, commands, and configuration support only when implemented and exercised. Do not turn a planned capability into an initialize claim.
- Release sessions, listeners, pending requests, and owned resources on client disconnect or shutdown. Do not write user-global configuration as a side effect of session teardown.

## Evidence and compatibility baseline

The preparation conversation included these observations on 2026-10-29:

- Installed OMP reported `18.13.3`, Bun reported `1.4.4`, and seshd reported `0.25.2`.
- A direct `omp acp` initialize request negotiated protocol v1 and advertised image/embedded-context prompts, MCP HTTP/SSE, session load/list/resume/fork/close, and a steering extension. This proves advertised support only. It does not establish that every path works correctly in Sesh.
- `PI_PY=false PI_JS=false` made the installed configuration report both `eval.py` and `eval.js` as false. `PI_PY=false PI_JS=false omp acp --no-lsp` completed an initialize exchange. That probe created no model-backed turn and did not verify Sesh rendering or the resulting tool roster.
- Published OMP tool-admission code omits eval when neither backend is enabled. Published SDK documentation describes explicit tool restriction, local configuration overrides, cancellation, persistence, and streaming events. Recheck against the pinned package rather than assuming current main matches it.
- Sesh documents custom ACP agent registration and MCP-backed session management. Its start-session tool offers default worktree behavior, an in-place option, parent reporting, and agent selection; it does not imply arbitrary OMP role/model configuration.

A reversible baseline launch for comparison is:

```sh
PI_PY=false PI_JS=false omp acp --no-lsp
```

This command is for an ACP client launcher, not an interactive shell conversation. It only changes the eval/LSP portion of the existing OMP integration; it does not implement Pico or replace native subagents. Do not change the user's active agent registration during development without permission.

## Prototype acceptance criteria

1. Use the companion's supported GUI setup path to connect a real Pico executable as a custom agent in Sesh. Create a session, send a prompt, and observe a streamed reply through the OMP SDK.
2. Exercise retained read/search/edit/write/shell behavior in a disposable project. Each executed tool appears as a correctly identified tool call with appropriate output, status, locations, and diffs. Failed tools remain visibly failed.
3. Inspect the effective roster and exercise attempted excluded-tool dispatch. Eval, built-in LSP, and native task/agent/workpool paths are unavailable, including indirect and extension-mounted routes. No automatic OMP LSP diagnostics or formatting occurs.
4. Complete a code-intelligence task using the user's `intellisense` installation through a visible execution call. Ordinary code editing and project checks remain usable without eval or OMP LSP.
5. Exercise approval, rejection, cancellation while approval is pending, and cancellation during a running command. Rejected/cancelled work does not execute afterward, and a subsequent prompt works.
6. Select a supported model and reasoning level through Sesh, and verify that the engine uses the selection. Unsupported selectors, modes, and commands are absent.
7. Ask a structured question and exercise Sesh artifacts and notifications through the supplied MCP tools. Verify actual Sesh surfaces and that tools are not duplicated by local MCP discovery.
8. Delegate a task to a real Sesh child using Pico. Observe it under the parent, inspect its tool stream, receive its result, and verify that disabled features remain disabled there. Exercise a child failure or user-input wait without reporting it as successful completion.
9. Demonstrate separate child worktree behavior and explicit integration of an implementation child's changes. Required uncommitted parent context is communicated deliberately.
10. Stop the adapter, reopen the session, and continue with the expected context. Check transcript replay for duplication and stale tool statuses, then verify disconnect cleanup.
11. Run the repository quality gate and a protocol-driving smoke scenario against the actual executable. Run applicable ACP compatibility-kit checks and record unexercised requirements. The experimental kit is not a complete conformance certificate.
12. Compare representative coding work with the user's existing OMP/Sesh setup. Record concrete effects of removing eval/LSP and using child sessions, including lost conveniences and any host/SDK gaps. Keep those observations separate from assumptions.
13. On a fresh macOS user account with Pico and Sesh installed, complete provider sign-in/API-key setup, model selection, and the first Sesh prompt without Terminal, a global Bun/OMP installation, PATH changes, or manual config editing. Browser-based OAuth/device confirmation and supported Sesh GUI actions are allowed.
14. Exercise the native settings window in real use. Verify the System Settings-style sidebar/detail/grouped-form hierarchy and CodexBar-inspired provider/account organization with keyboard navigation, VoiceOver, both appearances, and long provider/model names. Capture native visual evidence when the UI exists.
15. Change real settings, quit/reopen the app, and start a new Sesh session. Verify persistence, credential references, and model defaults while preserving an existing session's explicit choices. Failed/invalid saves must not corrupt the last valid configuration.
16. Exercise reuse of an existing OMP account and a Pico-managed credential through supported GUI flows. Cancel sign-in and disconnect a Pico reference without silently changing the user's terminal OMP credentials or defaults.
17. Check missing runtime/tool dependencies and authentication failures from a GUI-launched environment. Recovery must use supported GUI actions rather than treating a copied shell command as the only way forward.
18. Verify helper launch locations after app relaunch/relocation and the intended update path. Closing the configuration app must not terminate a Sesh-owned agent session; an update must not replace assets in use by an active session.

A passing formatter or a successful initialize exchange alone does not satisfy these criteria. Record the tested package versions, Sesh version, actual scenarios, and limitations with the implementation.

## Implementation order for the separate session

1. Read this brief and the Workbench contract, run `mise run status` and `bd prime`, and use the brief as input to the normal proposal and approval process. Install the pinned toolchain/dependencies, run the baseline quality gate, and inspect the installed public OMP and ACP APIs.
2. Prove the critical SDK hooks for tool restriction, permission requests, MCP injection, cancellation, GUI authentication, model catalogs, and credential-store access. Establish the native app/helper configuration boundary and resolve actual SDK gaps before building around assumed hooks.
3. Build the stdio executable and one complete Sesh prompt/tool/approval/cancellation path, with the curated settings applied from session creation.
4. Implement the native configuration app and app-managed runtime/helper path alongside persistence, supported selectors, Sesh MCP interactions, and child-session delegation. Test each capability before advertising it.
5. Exercise the acceptance scenarios in a disposable project, a fresh-user GUI environment, and actual Sesh. Update launch/GUI setup instructions and evidence, then commit coherent verified changes locally.

No placeholder ACP server, fabricated result, blanket capability advertisement, decorative settings controls, or hidden fallback counts as implementation. The native configuration app is in scope; a replacement chat UI, web frontend, notebook renderer, global LSP configuration, automatic child merge system, and general-purpose multi-engine framework are not. This preparation change adds project metadata only; app screens, runtime packaging, and distribution remain implementation work under Workbench.

## References

- [OMP SDK](https://omp.sh/docs/sdk)
- [OMP ACP behavior](https://omp.sh/docs/acp)
- [OMP settings and precedence](https://omp.sh/docs/settings)
- [OMP ACP source](https://github.com/can1357/oh-my-pi/tree/main/packages/coding-agent/src/modes/acp)
- [OMP tool admission](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/tools/index.ts)
- [ACP initialization and capabilities](https://agentclientprotocol.com/protocol/v1/initialization.md)
- [ACP tool calls and permissions](https://agentclientprotocol.com/protocol/v1/tool-calls.md)
- [Official ACP TypeScript SDK](https://agentclientprotocol.com/libraries/typescript.md)
- [ACP compatibility kit](https://agentclientprotocol.com/libraries/testing.md)
- [Sesh custom agents](https://sesh.codes/docs/more-agents/)
- [Sesh agent tools and child sessions](https://sesh.codes/docs/agents-that-start-sessions/)
- [Sesh approvals and Autonomous mode](https://sesh.codes/docs/approvals-and-autonomous/)
- [Apple Human Interface Guidelines: Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
- [CodexBar UI and Settings behavior](https://github.com/steipete/CodexBar/blob/main/docs/ui.md)
- [CodexBar provider configuration](https://github.com/steipete/CodexBar/blob/main/docs/configuration.md)
