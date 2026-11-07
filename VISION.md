---
title: A Vision for Pico
updated: 2026-11-06
---

# A Vision for Pico

## Introduction

Pico exists to let Sesh drive an agent built on the OMP SDK over the Agent Client Protocol. It serves a user who wants OMP's agent engine with Sesh as the primary conversation UI and workspace host.

OMP supplies the provider/model loop and permitted coding tools. Sesh supplies the conversation UI, host tools through MCP, workspaces, and the visible child-session tree. Pico connects those systems and enforces a selected runtime policy.

The user installs and updates Pico with Homebrew and configures it in a native macOS companion app rather than a terminal: providers and credentials, model and reasoning selection, the runtime policy, and diagnostics when something is wrong. The app now reads the real model catalog and saves model and reasoning defaults through `pico`'s commands; General shows the settings file location and checks command readiness with confirmed Homebrew recovery, and Tools displays the fixed built-in policy. Sample-data mode has been removed. Provider setup, the separate version rows, integrations, Sesh setup, and the Diagnostics pane remain visibly unconnected.

## Goals

- Make retained coding tools and human interactions understandable and actionable in Sesh.
- Keep agent-requested execution visible, with accurate progress, results, errors, and cancellation.
- Use the user's preferred external `intellisense` CLI without a competing built-in LSP integration.
- Give delegated work one visible execution backend through Sesh child sessions.
- Let a user install and update Pico with one Homebrew command (`brew install markmals/tap/pico`) and configure it from a native Mac app, without a hand-edited configuration file.

## Minimum viable product

The useful minimum is a local executable that Sesh can launch to run an OMP SDK session, perform the selected coding operations, use Sesh MCP tools, and delegate through real Sesh child sessions. The core adapter turn path exists ([proposal 0001](proposals/0001-acp-adapter-core.md)): retained tools, model and thinking-level selection, and cancellation work. It ships as `pico`, a single executable installed through Homebrew ([proposal 0002](proposals/0002-pico-homebrew-distribution.md)). Child-session launches now inherit the parent’s registered Pico agent and reject harness overrides ([proposal 0003](proposals/0003-pico-only-child-sessions.md)), with a real Pico parent/child flow exercised in Sesh. The broader delegation handoff, result-state and integration workflow remain follow-up work.

Session restoration now works through ACP load, list and resume ([proposal 0004](proposals/0004-session-restoration.md)). Pico keeps its private OMP-format agent context and session-local model and thinking choices in Application Support; Sesh retains its client-owned history and conversation UI. A real Sesh stop/reopen flow verified continuation without duplicating the client transcript.

The agent's task list now reaches Sesh as its plan ([proposal 0006](proposals/0006-todo-plan-updates.md)). OMP's `todo` tool reports a flat list through ACP plan updates instead of transcript rows, failed updates remain visible as failed tool calls, and a reopened session shows the current list. A real Sesh session verified the plan panel, the absence of todo rows and the restored plan after resume.

Pico owns its configuration ([proposal 0007](proposals/0007-pico-owned-configuration.md)). A versioned settings file holds model/thinking defaults, the background-command setting, and provider credential references, read and changed through agent-first commands. Credentials belong to Pico's login-Keychain store ([proposal 0009](proposals/0009-pico-credentials-and-provider-login.md)): the agent hands the human an SDK authorization URL, then explicitly selects the stored credential. A changed selection applies to every session's next provider request without changing its model or reasoning level. No OMP credential store or implicit environment credential authorizes Pico. The companion app uses the model/settings commands; its credential and provider controls remain follow-up work.

Background commands are visible and owned by their turn ([proposal 0008](proposals/0008-background-bash-jobs.md)). A `bash` command that moves to the background, by request or after a Pico-set threshold, stays one tool call that streams its output and ends with the job's outcome; OMP's `wait` reports the jobs it blocks on. A turn ends only after its jobs and the runs they wake, which Sesh shows in that turn, and Stop, failure or disconnect stops every running job and waits for its processes. Processes a finished command leaves behind, and daemons, are not yet tracked. Real Sesh sessions verified the streamed job card, the same-turn follow-up, `wait`, Stop, agent shutdown and the auto-background setting.

Permissions, cancellation, and session restoration must work through that same interaction surface.

The companion app is part of that minimum: a native macOS application, installed with Pico through Homebrew, that signs the user in to their providers, selects the model and reasoning effort, and registers the agent with Sesh. Its layout follows macOS System Settings, and its provider and model configuration follows CodexBar's; the [native macOS configuration app](PROTOTYPE.md#native-macos-configuration-app) section of the brief carries the detail. Shipping it through Homebrew needs a cask, which needs Developer ID signing and notarization. Built so far: the Tuist project and native window, navigation, history, search and `pico://` links from [proposal 0005](proposals/0005-mac-app-ui-workspace.md), plus the connected Models pane and Settings file row. Model and reasoning choices save optimistically with ordered writes, rollback and conflict recovery ([policy 0001](policies/0001-optimistic-configuration-saves.md)). General now separates executable installation, command startup and update currency, retains the settings path when the model catalog fails, and offers explicit update checks and confirmed Homebrew recovery with separate tap-trust approval. Startup checks do not claim provider authentication or model-turn success. Tools shows the complete fixed policy, including Task list and Wait. Native UI and command flows were exercised; package mutations used controlled executables rather than the user's Homebrew installation. The remaining controls and app distribution are tracked under Beads `pico-bfk`; the app is still an unsigned development build.

[`PROTOTYPE.md`](PROTOTYPE.md) supplies the implementation brief and observable acceptance scenarios. It informs Workbench proposal development and does not replace proposal approval.

## Design principles

Every agent-requested tool execution and delegated task is visible to the client. A shell tool's subprocesses belong to that visible execution; internal engine computation does not require fabricated tool calls. A call whose whole effect is plan state, such as a successful `todo` update, is visible as that plan.

Capability is claimed only after it is exercised. Advertised tools perform their documented operation, and unsupported features stay out of the interaction surface.

Sesh MCP tools are first-class named tools for questions, artifacts, notifications, and session management. File operations, search, and `intellisense` use their own visible coding or execution tools.

Pico’s runtime delegation uses Sesh child sessions running the same registered Pico agent. Native worker execution hidden behind a synthetic session card would defeat the desired visibility.

Configuration is native and truthful. The companion app's connected controls use Pico's command contract and offer only the engine's real capabilities; unfinished controls remain visibly unavailable and never simulate success. Pico's behavior comes from its own settings, explicit credential selections and fixed policy, never from the user's OMP configuration. Every setting is reachable through commands an agent can discover and verify.

## Beyond the minimum

Additional ACP capabilities or OMP interaction features can be evaluated after the selected workflow is exercised. Features that require new Sesh rendering are not prerequisites for the prototype, and their inclusion depends on actual host support and user need.

## Non-goals

- Python and JavaScript eval are excluded for this experiment because their current shell-like presentation and syntax highlighting in Sesh do not meet the user's needs. The experiment will establish which persistent-runtime and orchestration conveniences are missed.
- A built-in language server and automatic LSP hooks are excluded because the user prefers the configuration and agent-oriented subcommands of the external `intellisense` CLI.
- OMP's native task, agent, and workpool delegation is excluded from the Pico runtime because a second backend would split the visible session tree.
- A web application, hosted service, or deployment pipeline is unnecessary for a local adapter and a local app. Sesh remains the conversation UI; the companion app configures, inspects and manages Pico rather than rendering a second chat.

## Development workflow

The repository retains the template's Workbench process and Beads work tracker. Runtime exclusions describe the Pico product; they do not remove development-time review, delegation, proposals, or other Workbench practices. [`AGENTS.md`](AGENTS.md) is the operative contract; [`PROCESS.md`](PROCESS.md) describes the workflow in full.

## Related documents

[`PROTOTYPE.md`](PROTOTYPE.md) holds the planned behavior, acceptance criteria, and evidence requirements. [`README.md`](README.md) describes the current tooling and process.

## Revision history

| Date | Change | Related proposal |
| --- | --- | --- |
| 2026-10-29 | Record the Pico runtime direction and preserve the template's Workbench and Beads workflow. | N/A: project preparation brief |
| 2026-10-29 | Make the native macOS companion app Pico's configuration surface and prepare its project configuration. | N/A: project preparation brief |
| 2026-11-01 | Record the exercised core adapter capabilities and Pico-only child-session launches. | [proposal.0001](proposals/0001-acp-adapter-core.md), [proposal.0003](proposals/0003-pico-only-child-sessions.md) |
| 2026-11-01 | Make Homebrew Pico's install and update path, with the app as the configuration surface. | [proposal.0002](proposals/0002-pico-homebrew-distribution.md) |
| 2026-11-01 | Record private agent-session persistence and exercised Sesh restoration, with Sesh retaining the client transcript. | [proposal.0004](proposals/0004-session-restoration.md) |
| 2026-11-02 | Record the accepted Mac app UI scaffold: System Settings navigation, history, search and links, six unconnected panes, and a labelled sample-data mode; configuration waits for #12. | [proposal.0005](proposals/0005-mac-app-ui-workspace.md) |
| 2026-11-02 | Record the todo list as Sesh's plan: flat ACP plan updates, failures as tool calls, and the current plan on reopen. | [proposal.0006](proposals/0006-todo-plan-updates.md) |
| 2026-11-02 | Record Pico-owned configuration: a versioned settings file and agent-first `pico` commands for the default model and thinking level, and Pico sessions that reuse nothing from OMP's configuration but credentials. | [proposal.0007](proposals/0007-pico-owned-configuration.md) |
| 2026-11-03 | Record background `bash` jobs and `wait`: jobs reported in their starting call and owned by their turn, stopped with the turn or the session, and auto-background as a Pico setting; leftover and daemon processes remain untracked. | [proposal.0008](proposals/0008-background-bash-jobs.md) |
| 2026-11-03 | Add Pico-owned Keychain credentials and agent-only URL login, explicit global provider selections, and no implicit OMP credential reuse; GUI setup and Autonomous support remain separate. | [proposal.0009](proposals/0009-pico-credentials-and-provider-login.md) |
| 2026-11-05 | Connect the Mac app's model/reasoning defaults and Settings file row, remove sample mode, and establish optimistic saves for reversible settings; other controls remain separate work. | [proposal.0007](proposals/0007-pico-owned-configuration.md), Beads `pico-bfk.5` and `pico-bfk.8` |
| 2026-11-06 | Record accepted runtime readiness and confirmed Homebrew recovery, catalog-independent settings locations, the complete fixed tool policy, and the native System Settings design pass. | Beads `pico-bfk.13`, `pico-bfk.15`, `pico-bfk.19`, and `pico-bfk.25` |
