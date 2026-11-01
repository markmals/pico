---
id: proposal.0003
title: Pico-Only Child Sessions
authors: [Mark Malstrom]
status: implemented
pull-request: https://github.com/markmals/pico/pull/4
issues: []
supersedes: []
---

# Pico-Only Child Sessions

## Summary

Make Pico’s Sesh child-session tool inherit the parent’s registered agent and reject all agent overrides. Reviews and other delegated work stay in Pico without restricting model/provider selection. Preserve Pico’s existing approval-free tool policy; this change does not add an execution sandbox.

## Motivation

Mark has observed OMP running in Sesh start Codex-harness review sessions. A review should not silently switch away from Pico’s tool roster, approval policy, and execution backend. Disabling OMP’s native subagents does not prevent this switch: Sesh’s own child-session tool accepts an explicit agent selection.

Inspection of the relevant local Sesh events on 2026-10-31 found a review launch through `start_session` with `agent: "codex"`. The parent was running stock OMP, not Pico. This establishes the observed route, not a claim that a Pico child has already been exercised. Before this change, Pico admitted that host-supplied tool without constraining its agent argument.

Mark also reported repeated approval requests for `rm -rf` cleanup in `/tmp`. Those recorded requests came from stock OMP’s ACP permission gate. Its critical-command decisions remain per-call even after an “Always allow” answer. Pico already promises no approval requests under [proposal 0001](0001-acp-adapter-core.md#approvals), and does not install that gate. A separate `/tmp` exemption would neither fix a stock-OMP session nor establish that a file belongs to an agent. This proposal does not change the approval policy.

## Domain grounding

### Established context

- [Sesh’s child-session documentation](https://sesh.codes/docs/agents-that-start-sessions/) describes real sessions under their parent, separate worktrees by default, host-owned completion reporting, and optional selection of another agent. It also documents the current eight-working-children limit and prohibition on child-created grandchildren.
- The live Sesh `start_session` tool schema inspected on 2026-10-31 declares an optional `agent` string whose documented default is the parent’s agent. The same surface offers `project`, `prompt`, `name`, `baseBranch`, `reportBack`, and `inPlace`. These are host contracts, not ACP-standard delegation fields.
- [Sesh’s custom-agent setup](https://sesh.codes/docs/more-agents/) registers an executable per machine. Registration identity is not a model name, a display label, or ACP’s self-reported agent name. The live `session_info` and `list_sessions` tools report an `agent` identity; the current OMP session reports `oh-my-pi`.
- [ACP permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission) are requests made by the agent to the client. They are distinct from Sesh’s question tool and from the lifecycle of a child session.

### Relevant constraints and principles

- **Harness versus model:** Pico is the executable and runtime policy. A provider/model used inside Pico is independent of that harness. A Codex model offered by Pico’s configured engine is permitted; launching the Codex harness as a child is not.
- **Registered agent versus label:** children inherit the parent’s actual Sesh registration. Pico must not assume that every installation uses a registration identifier or display name of `pico`, and must not read Sesh’s private registry files to invent that mapping.
- **Child session versus native subagent:** the supported delegated worker is a real Sesh child. OMP’s native task/agent/workpool facilities remain excluded. A synthetic session card around a hidden worker is not equivalent.
- **Tool policy versus process isolation:** enforcing the child-session tool’s arguments does not sandbox arbitrary shell commands, scripts, extensions, or third-party MCP services. On 2026-10-31 the human selected tool-level enforcement with normal shell access retained, rather than a process-isolation proposal.
- The installed OMP SDK is `@oh-my-pi/pi-coding-agent` 18.14.0. Its public `CustomTool` contract permits adaptation of the model-facing parameters and execution method. Its MCP bridge sets `strict: false`; removing a schema field alone does not enforce its absence at execution. The [public SDK documentation](https://omp.sh/docs/sdk) is background; the installed exported types govern implementation.

### Quality bar

A supported child launch cannot select another harness through Pico’s admitted Sesh tool, including when raw arguments bypass the advertised schema. A rejected request starts no child and appears as a failed tool call. Valid launches remain visible Sesh children, preserve host errors and cancellation, and inherit Pico without a hard-coded registration identifier. No hidden worker or alternate-harness fallback substitutes for a failed or unavailable launch.

### Remaining uncertainty

Same-registration inheritance was exercised with a real Pico parent and child in Sesh 0.25.2: both reported the registered agent `pico-dev`, and the child completed its retained read/shell operations. Only that installed host version was exercised; no older-host version floor is established. An incompatible tool contract must fail visibly rather than pass through unprotected.

## Existing baseline

[Proposal 0001](0001-acp-adapter-core.md) supplies the working ACP turn path and already excludes native OMP delegation. `adapter/engine/tool-roster.ts` admits the built-ins `read`, `grep`, `glob`, `edit`, `write`, `bash`, and `web_search`. Host-supplied MCP tools are added separately.

`adapter/engine/host-mcp-servers.ts` connects the client-supplied servers, rejects duplicate server names and normalized tool-name collisions, and returns `manager.getTools()` without a delegation-specific adaptation. `adapter/engine/pico-session.ts` admits those tool names, mounts their implementations, and verifies the final roster. Preserve that connection ownership, collision checking, restricted roster, and ordinary Sesh interaction tools.

`adapter/engine/agent-guidance.ts` explains the Sesh interaction surface and worktree context but does not establish a Pico-only child launch rule. Its prompt adaptation removes the native subagent URL. Preserve the exclusion rather than restoring native workers for reviews.

For cleanup, `pico-settings.ts` explicitly overlays `yolo`, allows configured per-tool approval policies, and clears restricted folders; session creation also sets `autoApprove: true`. `WriteBridge` advertises only client text writing, not permission requests. Inspection of OMP 18.14.0’s `session-tools.ts`, `tools/bash.ts`, and `tools/approval.ts` traced the stock-OMP critical-command prompt and Pico’s different path. A nonexecuting policy probe classified `rm -rf /tmp/pico-approval-policy-probe` as critical, then resolved it under Pico’s settings to `policy: "allow", override: false`. No cleanup command was executed, and this is not a live Pico/Sesh cleanup claim.

## Proposed solution

Expose the existing Sesh `start_session` tool as a Pico-constrained operation: it has no agent-selection field, and supplying that field anyway fails before dispatch to Sesh. An accepted call omits `agent`, relying on Sesh’s same-registration default. This avoids a second agent-identity configuration and works with installation-specific registration names.

```text
Pico parent → start_session(project, prompt) → visible Sesh child using the parent’s Pico registration
Pico parent → start_session(..., agent: "codex") → failed tool call; no child started
```

Add guidance that reviews and other delegated work use that Sesh operation, never a native worker or shell-launched harness. This guidance directs normal behavior; the runtime argument check enforces the supported tool boundary. Neither is presented as an operating-system sandbox.

## Detailed design

### Adapt the supported Sesh tool once

Adapt the client-supplied Sesh server’s original `start_session` tool before its schema and implementation enter the admitted engine roster. Use the original server/tool identity (`sesh` and `start_session`), not an agent-authored title, display label, or a guessed normalized name. Retain the existing cross-server collision checks.

The model-facing tool keeps its existing minted name, `mcp__sesh_start_session`, and its ordinary Sesh purpose. For a compatible host contract, remove the optional `agent` selector from the parameters. Its description states that children use this session’s registered agent and that choosing a different harness is unsupported. Preserve all other host parameters and their requiredness; Sesh continues to own project lookup, worktree creation, reporting, and launch validation.

Only the adapted implementation is admitted under that tool name. Do not retain a second unadapted alias or an indirect device route. Do not mutate shared SDK tool schemas or lose class method receivers while adapting the tool. Preserve the original execution context, progress callback, cancellation signal, MCP identity metadata, and result/error handling.

If Sesh supplies the tool with a schema that cannot safely express this narrowed contract, fail `session/new` with an error naming the incompatible Sesh `start_session` contract. A schema that requires `agent`, directly or through a closed object’s minimum property count, is incompatible because it cannot accept an inherited-agent launch. Never mount its original implementation as a fallback. When Sesh supplies no `start_session` at all, retain proposal 0001’s behavior: the session can perform its other work, but delegation is unavailable. Other servers’ unrelated tools are not reclassified from their titles.

### Reject overrides at the execution boundary

Before invoking the original Sesh tool, reject any request supplying an `agent` field, regardless of its value. This includes `"codex"`, `"claude"`, `"oh-my-pi"`, `"pico"`, the parent’s own identifier, an empty string, and `null`. A guessed or stale caller receives the same rule as a model that obeyed the new schema.

Return a failed tool result explaining that Pico children inherit the parent’s agent and do not accept a harness override. No Sesh launch request is made for that invocation, and no child is created. Do not silently strip an explicit override, substitute a different agent, or retry the launch under another harness.

An accepted request has no `agent` field. Forward it through the existing Sesh implementation without adding an agent identifier or changing unrelated launch options. Sesh’s documented default selects the registration that launched the parent. A Sesh validation error, missing executable, host limit, or failed launch remains a visible failure with its cause; none authorizes a different harness.

### Keep delegation visible and Pico-specific

Pico’s guidance directs reviews and other delegation to the supplied Sesh child-session tool. It explains same-agent inheritance and the lack of a harness selector. It does not copy Sesh’s entire orchestration manual or promise OMP specialist-role/model options that the host does not expose.

Guidance forbids shell-launched agent harnesses and native worker execution as delegation fallbacks. If the supported host operation is unavailable or fails, the parent reports that limitation or performs the work itself. It does not describe an ordinary subprocess as a Sesh child.

OMP’s native `task`, eval-based agent/workpool helpers, and vibe delegation remain absent under proposal 0001. No new delegation API, nested-worker backend, automatic merge, or cross-harness escape hatch is introduced. Sesh’s existing message/read/wait/stop semantics and limits are unchanged.

### Preserve runtime policy and observability

All children launched through this tool use the same registered Pico executable and therefore construct their own Pico sessions with the curated policy. Verify that result rather than treating omission of `agent` as sufficient end-to-end evidence. Model and reasoning selection continue to use whatever Pico and Sesh actually support; this proposal neither pins them to the parent nor introduces per-child selection.

Valid launches and rejected overrides appear under the real tool name in the existing ACP tool stream. A rejected override has failed status, not a completed launch or a fabricated child identifier. Sesh owns the child’s actual session tree and lifecycle. Tool cancellation and host failures continue through the existing MCP/ACP path.

Pico’s no-approval behavior is unchanged for parent and child. Do not add a `/tmp` allowlist, infer creation ownership from a pathname, alter stock OMP’s launcher, change the user’s global OMP settings, or automatically replace the active Sesh agent.

### Verify the enforcement boundary

Derive behavioral regression coverage from the rejected-override boundary: requests that bypass the schema, including empty and null selections, fail before any launch occurs. Cover incompatible host schemas without leaving an unprotected launch tool active. Existing valid-tool, host-error, cancellation, collision, and excluded-roster behavior must remain intact; do not add tests that merely compare guidance wording or echo unchanged arguments.

Use a real Pico parent in Sesh to launch a harmless review child without `agent`. Observe the child under the parent, compare the reported parent/child registration identities, and exercise the child’s curated tool policy. Confirm that a rejected override produces no new child and no alternate harness process. Record the Sesh and Pico versions used. If the host does not honor same-agent inheritance, stop implementation and revise the proposal; do not guess an identifier or weaken the claim.

## Compatibility

Calls that explicitly select any agent through Pico’s Sesh child-session tool now fail, even if the selected identifier happens to name the parent’s Pico registration. Callers omit `agent` instead. Other Sesh launch arguments, tools, child lifecycle operations, and model/provider choices keep their existing contracts.

There is no stored-session migration, global configuration rewrite, or change to the user’s stock OMP, Codex, or Claude installations. Existing sessions running those harnesses do not acquire Pico’s policy retroactively. An incompatible supplied launch-tool schema makes Pico session creation fail explicitly rather than leaving delegation partially protected.

## Implications on adoption

Start the parent with the user’s registered Pico executable using the existing [Sesh guide](../guides/running-pico-in-sesh.md). Do not hard-code a registration name or silently change which agent Sesh uses. The proposed adapter needs Sesh’s same-agent default for child launch; verify the actual installed host rather than asserting an untested version floor.

No new credentials, provider integration, service, sandbox, or private Sesh API is required. Reverting to the earlier executable restores its unconstrained Sesh agent argument; other installed harnesses and registrations remain untouched.

## Scope

- Narrow and enforce Pico’s admitted Sesh child-launch operation, including failure on incompatible supplied schemas.
- Explain the supported delegation path and prohibit native/shell harness fallbacks in Pico guidance.
- Verify the runtime boundary and exercise actual Pico-to-Pico inheritance in Sesh.
- Update the existing Sesh guide and include a changeset describing the implemented restriction.

### Out of scope

- Process-level isolation, command blacklists, or a claim that arbitrary shell scripts and third-party integrations cannot execute another program. The human explicitly chose tool-level enforcement with ordinary shell access retained.
- Changing approval policy or fixing stock OMP’s ACP gate. The observed cleanup prompts were not emitted by Pico.
- Designing the full delegation lifecycle, read-only research profiles, automatic integration, new specialist roles, or model selection for children. The remaining delegation work stays tracked in Beads `pico-3b8`.
- Session persistence, Autonomous support, the Mac configuration app, Sesh registration automation, and changes to Sesh itself.
- Restricting which provider/model Pico may use merely because its name includes Codex.

## Preview

- Repository shape: local stdio ACP executable, not a web or documentation preview.
- Artifact: the source launcher produced by `mise run acp:launcher` from this branch, used by a real Sesh parent and child. It exercises the actual executable/tool path without depending on a separate distribution change.
- Access: local developer checkout and a user-approved custom Pico registration through Sesh’s supported setup. Do not replace the user’s active registration or start a model-backed review during proposal development.
- Exercise: a harmless child review in a disposable project; inspect its parent relationship, agent identity and curated policy, then attempt an override and observe the failed call with no extra child. Inspect failure/cancellation in the existing visible tool stream.
- Completion cleanup: stop/archive disposable sessions through Sesh and remove only the implementation’s own temporary project and preview registration with the user’s permission. Leave existing registrations, credentials, and terminal sessions unchanged.
- Current state: verified from runtime revision `5090206` in Sesh 0.25.2. Parent `f0bee81d-2766-4702-8c93-30fb6595bb5e` and child `ff5faee3-946b-44f8-ae4d-c1d696b50be9` both used `pico-dev`. The child’s read and shell calls completed; the explicit-agent and missing-project launch attempts failed with no extra child. Parent and child recorded no permission events. The temporary development launcher redirect was restored to its original bytes.

## Policies and decisions checked

- Formal policy records: None. `policies/` contains only its index.
- Formal decision records: None. `decisions/` contains only its index.
- [VISION.md](../VISION.md) requires one visible Sesh delegation backend and excludes native OMP delegation. This proposal enforces harness selection within that backend without inventing hidden workers.
- [Proposal 0001](0001-acp-adapter-core.md) establishes the restricted roster, direct Sesh tools, truthful failures, and no approvals. This change narrows the host tool’s agent argument while preserving those contracts.
- [PROTOTYPE.md](../PROTOTYPE.md#delegation-through-child-sessions) calls for the same registered Pico agent and verification of inheritance. This proposal delivers that identity boundary, not the entire follow-up delegation workflow.
- [The enforcement hierarchy](../.agents/rules/enforcement-hierarchy.md) favors deterministic enforcement over instructions. The execution-time check, rather than the prompt or schema alone, owns override rejection.

## Future directions

The broader delegation proposal can define task handoffs, result-state handling, and deliberate integration of separate worktree changes. None needs an alternate harness. Process isolation would be a separate change with its own compatibility and security model, not an extension of the claim made here.

## Alternatives considered

- **Guidance or schema narrowing alone:** smaller, but not enforcement. OMP’s non-strict MCP bridge can forward an extra `agent` field despite the advertised schema. Rejected because a model mistake would still switch harnesses.
- **Strip explicit overrides silently:** would keep the forwarded request on the inherited agent, but reports a different launch than the caller requested. Rejected in favor of a visible failed request and no launch.
- **Look up and inject a Pico identifier:** adds identity resolution and drift without improving the host’s existing same-agent contract. A display label or fixed `pico` string is not authoritative; private registry-file access is not a supported integration. Omission avoids that second configuration.
- **Process sandbox or shell-command filtering:** a real process boundary would be broader and could constrain normal development tools; command-name filtering is bypassable through scripts, aliases, and renamed executables. The human selected the narrower enforced-tool contract instead. Guidance still prohibits shell-harness delegation as normal agent behavior.

## Open questions

None about the selected behavior. The human approved implementation on 2026-10-31 and accepted the result on 2026-11-01 with explicit authorization to merge and clean up. The live verification is recorded above. Merge-only integration and preview teardown are authorized; no tag, package release or deployment is authorized.
