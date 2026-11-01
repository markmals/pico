---
title: A Vision for Pico
updated: 2026-11-01
---

# A Vision for Pico

## Introduction

Pico exists to let Sesh drive an agent built on the OMP SDK over the Agent Client Protocol. It serves a user who wants OMP's agent engine with Sesh as the primary conversation UI and workspace host.

OMP supplies the provider/model loop and permitted coding tools. Sesh supplies the conversation UI, host tools through MCP, workspaces, and the visible child-session tree. Pico connects those systems and enforces a selected runtime policy.

The user configures all of that in a native macOS companion app rather than a terminal: providers and credentials, model and reasoning selection, the runtime policy, and diagnostics when something is wrong. What exists in the repository today is that app's project configuration. No screen, no authentication flow, and no bundled runtime has been written.

## Goals

- Make retained coding tools and human interactions understandable and actionable in Sesh.
- Keep agent-requested execution visible, with accurate progress, results, errors, and cancellation.
- Use the user's preferred external `intellisense` CLI without a competing built-in LSP integration.
- Give delegated work one visible execution backend through Sesh child sessions.
- Let a user install, configure and update Pico from a native Mac app, without a terminal, a package manager, or a hand-edited configuration file.

## Minimum viable product

The useful minimum is a local executable that Sesh can launch to run an OMP SDK session, perform the selected coding operations, use Sesh MCP tools, and delegate through real Sesh child sessions. The core adapter turn path exists ([proposal 0001](proposals/0001-acp-adapter-core.md)): retained tools, model and thinking-level selection, and cancellation work. Child-session launches now inherit the parent’s registered Pico agent and reject harness overrides ([proposal 0003](proposals/0003-pico-only-child-sessions.md)), with a real Pico parent/child flow exercised in Sesh. Session restoration and the broader delegation handoff, result-state and integration workflow remain follow-up work.

Permissions, cancellation, and session restoration must work through that same interaction surface.

The companion app is part of that minimum: a native macOS application that installs what Pico needs, signs the user in to their providers, selects the model and reasoning effort, and registers the agent with Sesh. Its layout follows macOS System Settings, and its provider and model configuration follows CodexBar's; the [native macOS configuration app](PROTOTYPE.md#native-macos-configuration-app) section of the brief carries the detail. Prepared so far: a Tuist project definition and the pinned toolchain that generates it.

[`PROTOTYPE.md`](PROTOTYPE.md) supplies the implementation brief and observable acceptance scenarios. It informs Workbench proposal development and does not replace proposal approval.

## Design principles

Every agent-requested tool execution and delegated task is visible to the client. A shell tool's subprocesses belong to that visible execution; internal engine computation does not require fabricated tool calls.

Capability is claimed only after it is exercised. Advertised tools perform their documented operation, and unsupported features stay out of the interaction surface.

Sesh MCP tools are first-class named tools for questions, artifacts, notifications, and session management. File operations, search, and `intellisense` use their own visible coding or execution tools.

Pico’s runtime delegation uses Sesh child sessions running the same registered Pico agent. Native worker execution hidden behind a synthetic session card would defeat the desired visibility.

Configuration is native and truthful. The companion app reuses credentials by explicit choice, offers models from OMP's available catalog, and exposes only settings backed by real capabilities.

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
