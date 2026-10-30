# Workbench Agentic Development Process

This document describes the development process this project uses. [`AGENTS.md`](AGENTS.md) is the operative contract; this is the full description behind it.

The process is intended to be generalizable to any modern agentic coding harness that reads `AGENTS.md` and `.agents/skills/` from the repository root. Throughout this document, the harness and the model driving it are collectively referred to as _the agent_, and the person who owns the project as _the human_.

The process starts with understanding the problem. For substantive changes, the agent grounds the domain, makes intent explicit with the human, then represents it independently in tests, documentation, and code. The resulting behavior is reviewed from multiple perspectives and finally verified by a human before release.

## Goals

- Preserve a coherent long-term vision for the project even as individual features are developed independently.
- Make the intended behavior and scope of a feature explicit before implementation begins.
- Maintain multiple independently useful representations of that intent in proposals, tests, guides, and code.
- Make disagreements between those representations visible before a feature is released.
- Use agents for implementation and review without making the agent the final authority over product intent.
- Preserve enough design rationale, implementation history, and review discussion for future humans and agents to understand why the project is the way it is.
- Keep dependent projects synchronized as new functionality moves from development previews to production releases.

## Artifacts

### Visions

A _vision_ describes the project as a whole, including its purpose, minimum viable product target, design principles, and a possible future for the project beyond the current implementation.

The vision establishes the long-term direction against which individual proposals can be evaluated. It is created once near the beginning of the project and maintained as the project evolves.

### Policies

A _policy_ records a rule that should continue to be enforced across future work.

Policies capture constraints or conventions that should not have to be rediscovered from previous implementations or review discussions.

### Decisions

A _decision_ records an architectural or technical choice that should be remembered, including enough context to understand why that choice was made.

Future work may supersede a decision, but should do so explicitly rather than accidentally.

### Proposals

A _proposal_ describes a specific change to the project in enough detail to serve as the specification for its implementation.

Proposals record the motivation, intended behavior, scope, and relevant design decisions of a feature. They remain part of the project's history after implementation. A future proposal may revise or supersede an earlier proposal.

### Work items

A _work item_ is a tracked unit of work in Beads: a task, a blocker, a discovered defect, or a durable memory the project needs to survive a context reset.

Work items answer a different question from proposals. The proposal records reviewed intent and is preserved as history; the Beads graph records what is ready, what is blocked, what was deliberately deferred, and what a future session must know. Neither substitutes for the other.

### Tests

_Tests_ are executable specifications of the behavior described by a proposal.

They may include unit tests, integration tests, end-to-end tests, or other forms of automated verification implemented idiomatically for the implementation language and environment.

### Guides

_Guides_ are human-consumable Markdown documentation explaining how the proposed or implemented feature behaves and how it is used.

Guides provide a prose representation of the same behavior represented more formally by the proposal and tests.

### Code

_Code_ is the concrete implementation of the behavior described by the proposal, tests, and guides.

### Previews

A _preview_ is a prerelease form of the documentation or running software made privately available for human review.

A preview should be the cheapest realistic artifact through which a human can exercise the changed behavior. Both qualities matter: _cheapest_ rules out standing up production-grade infrastructure merely to review a change, and _realistic_ rules out screenshots, transcripts, and descriptions of what would happen.

What that artifact is depends on what the project is: a library ships a preview package; a web application or API a preview deployment; documentation a preview documentation deployment; a command-line tool an installable executable; a desktop application an installable build. This project's previews are the two programs it is here to build: the ACP adapter, run as a stdio executable and exercised from a real Sesh session, and the macOS companion app, launched and used. Until one of them is runnable there is nothing to preview, and the readiness report says so plainly.

A project wires the mechanism matching its own shape. Previews are private by default; a project makes one public only deliberately, as when a library publishes its documentation.

## Project Vision

A new project begins with the creation of its vision document.

The agent and the human develop the vision together before normal feature work begins. The document describes both the minimum viable version of the project and the broader direction in which the project may evolve.

The vision is not a collection of committed feature specifications. Individual changes are still designed and implemented through proposals.

Unlike proposals, however, the vision is a living document. After accepted features materially alter the project's capabilities or direction, the vision is updated so that it continues to describe the project accurately.

## Feature Development

Substantial feature work proceeds through five phases:

1. preparation,
2. proposal development,
3. implementation,
4. human review, and
5. completion and release.

The process is iterative. Findings during implementation or review may cause the proposal itself to change, at which point the implementation is reevaluated against the revised proposal.

The full feature loop applies to changes that decide new behavior or resolve a meaningful design choice. A correction whose intent is already established, such as an unambiguous bug fix or dead link, may be handled directly. If investigation uncovers a design choice, return to proposal development before implementing it.

The primary agent owns domain understanding, conceptual modeling, and proposal intent, and it usually implements the work itself. It delegates only independent slices that can run in parallel, and it uses a reframer when the problem formulation no longer explains the evidence. An independent adversary tries to falsify the finished work and reports findings without editing it.

Before entering the proposal path for a change, the agent asks the human whether they want a proposal, even if the request sounds like a feature or asks for one. An explicit yes for this change authorizes its proposal and later revisions, not future proposals. A no rules out the proposal and its draft pull request: proceed directly when intent is already clear, or clarify and narrow the work before implementation when a consequential design choice remains. This question precedes branch creation and PR preparation so unnecessary draft PRs are not opened.

## Preparation

After the human opts into a proposal for this change, work on the feature begins in an isolated Git branch.

The agent creates the branch, pushes it to the project's `origin` remote, and creates a draft pull request for the work.

Feature work that runs alongside other active work belongs in its own worktree. `wt switch --create <name>` creates one, trusts and installs its toolchain, and copies the ignored files listed in `.worktreeinclude`; the Beads database is shared across worktrees, so the work graph stays single.

The pull request becomes the durable workspace for the feature. It collects the proposal, implementation, review discussion, agent status reports, and other artifacts associated with the change.

The pull request remains a draft while the feature is being specified and implemented.

## Proposal Development

Before implementation, the agent and the human write a proposal describing the feature.

The proposal should make the intended change sufficiently concrete that the agent can derive tests, documentation, and an implementation from it without relying primarily on the original conversational request.

They iterate on the proposal until the human is satisfied that it represents the feature intended to be built.

The proposal is preserved after the feature ships. It becomes part of the historical explanation of the feature rather than merely temporary planning material.

If future work changes that design, a later proposal may revise or supersede it.

### Ground the problem

When a change depends on domain knowledge that cannot safely be inferred from the request, the agent uses `grounding-a-problem` before selecting an approach. Prefer authoritative sources; distinguish established knowledge, observed repository behavior, inference, and untested hypotheses. Record the context needed to judge the proposal in **Domain grounding**. When no independent research is needed, say why in that section rather than manufacturing it.

When important domain concepts, identities, relationships, states, or vocabulary change, use `ontology-review` before those assumptions harden into the detailed design. A material conceptual conflict goes back to grounding or the proposal, not directly into code.

### Study the existing baseline

After grounding, inspect the closest implementation, prototype, workflow, or prior attempt. Record what works, what should be preserved, and what is incidental or compromised in **Existing baseline**. Existing code is evidence of current behavior, not authority about the domain.

### Decide and record intent

Compare viable approaches against the grounded constraints, vision, policies, and decisions. Write the selected behavior in the proposal's **Detailed design**, with scope and unresolved questions explicit. The human decides when the proposal is settled and sets `awaiting-implementation`; an agent must not approve its own proposal.

## Implementation

After the human sets `awaiting-implementation`, the agent implements the proposal itself unless independent slices can run in parallel; a delegated slice gets its relevant detailed design, domain constraints, baseline, quality bar, governing records, scope, and verification commands, and `compiling-agent-goals` turns a large or repeated handoff into a written brief a fresh agent can execute. Use `reframing-a-problem` when repeated local fixes no longer explain the problem, or when a slice reports that the evidence contradicts the proposal's model; revise intent with the human before continuing.

### Behavioral Tests

The agent first writes failing tests for the observable behavior the proposal specifies when such tests add meaningful protection.

These tests establish an executable interpretation of the proposal before the implementation itself can influence what is considered correct.

The goal is not merely to increase test coverage, but to encode the externally meaningful behavior of the feature.

### Usage Guides

When the change has a user-facing surface, the agent then writes its guide from the proposal before production code exists. This forces the intended interface to be explainable independently from the implementation.

The agent compares the guide with the tests before implementing. A change with no user-facing surface needs no invented guide.

### Implementation

The agent implements the feature against the proposal, tests, and guides.

Implementation continues until `mise run check` passes. That single task is the project's blocking gate: formatting, linting, type checking, the workflow and skill-helper tests, the native project configuration, and the record validator. CI and the `pre-push` hook call the same task, so a local pass and a remote pass mean the same thing. Each program adds its own build and test tasks to that gate along with its code.

Passing the quality gates is necessary but not sufficient for the feature to be considered complete.

### Self-Check

Once the implementation passes its automated checks, the agent reads the proposal, tests, guides, and code together to find disagreement between the representations: tests that miss promised behavior, guides that describe something the tests do not exercise, code that implements behavior the proposal does not describe, or details that quietly changed scope or intent. It also asks whether this is the implementation that should remain — whether its structure expresses the grounded model or leaks implementation conveniences into public behavior — using `simplifying-code` as the lens. Where the change asserts an invariant, a state that cannot be reached or a value that cannot be constructed invalid, `verifying-invariants` supplies evidence for the claim instead of leaving it asserted. It fixes what it finds, or records a deliberate divergence for the human.

### Adversarial Review

The implementation is then reviewed once, independently, by a subagent with fresh context and preferably a different model. It receives the proposal and the work, and tries to falsify the claim that the work is done: missing or wrong behavior, weak or misleading tests, regressions, and security risks. It ignores style and reports without editing.

The primary agent fixes confirmed defects inside the proposal's scope, and runs the review again only when a fix was substantial. A finding outside that scope is never a reason to widen the change: it is declined with reasoning or filed in Beads. Declined findings are preserved for human review rather than silently discarded. The adversarial reviewer does not decide whether the feature is acceptable.

### Preview

Produce the preview selected in the proposal after review findings are resolved. It must be a usable build, installation, or deployed surface through which the human can exercise the changed behavior. Confirm that it runs; a green preview build alone is insufficient. A pure refactor without an exercisable surface needs no fabricated preview.

### Readiness Report

After the self-check, the adversarial review, and the preview, the agent posts a readiness report describing implemented behavior, verification, any declined findings, and how to exercise the preview. `reviewing-an-implementation` owns this handoff. Moving the proposal to `active-review`, posting the report, and marking the pull request ready form one transition into human review.

## Human Review

Human review determines whether the implementation actually satisfies the intended feature.

The human reviews both the agent's readiness report and the artifacts produced during development: the code diff, the proposal, tests, rendered preview documentation, a preview deployment, and preview packages consumed by draft pull requests in dependent projects, as applicable.

Review is not limited to reading generated artifacts. The preview forms of the feature are intended to make the actual behavior directly inspectable whenever possible.

The human leaves general or inline pull request comments describing changes they want, and may also edit and commit prose or code directly during review. Additional context may be supplied directly to the agent when it does not belong in a pull request comment.

If the feedback changes the intended design rather than merely correcting its implementation, the agent updates the proposal first.

The agent then repeats the affected tests, guides, code, validation, self-check, and adversarial review against the revised proposal as necessary.

Implementation and human review therefore form a loop:

**proposal → tests → guides → code → validation → self-check → adversarial review → preview → human review → revision**

The loop continues until the human accepts the feature.

## Policies and Decisions

Feature development may reveal information that should outlive the proposal itself.

When a feature establishes a rule that future work should continue to enforce, the agent should record or update that rule as a policy, after discussion with the human.

When a feature establishes an architectural choice that future work needs to understand, the agent should record or update that choice as a decision, after discussion with the human.

Policies and decisions are therefore not substitutes for proposals. A proposal explains a particular change; policies and decisions extract the durable constraints and architectural knowledge discovered while making that change.

Future proposals should be evaluated against the current vision, policies, and decisions.

## Work Tracking

During proposal development, implementation, automated validation, adversarial review, or human review, the agent discovers work that should be preserved independently of the current pull request. Beads (`bd`) holds it.

A defect that prevents the current implementation from satisfying its proposal remains part of the current work and should be fixed before the pull request is accepted. The agent does not file a work item merely to defer work the proposal already requires.

A defect is recorded in Beads instead when it is outside the scope of the current proposal, already exists on the main branch, affects another feature or project, or otherwise represents legitimate future work that should survive beyond the current pull request.

Before creating a new item, the agent searches the existing graph — `bd ready` for what is startable, then `bd search` and `bd list` across every state, open through closed, with the result limit lifted — so the same defect is not filed twice.

A work item should contain enough information for a future human or agent to understand and reproduce the defect without depending on the conversational context in which it was discovered: a concise description of the incorrect behavior, the behavior expected instead, reproduction steps or a minimal reproduction, relevant environment or version information, links to the proposal, pull request, test, or code where it was discovered, and any known constraints, suspected causes, or related defects.

```sh
bd create "Session cancellation leaves the child process running" \
  --type=bug --priority=1 \
  --description="Expected: cancelling a prompt turn terminates the delegated session. Actual: the child process survives and keeps writing. Repro: start a delegated session from Sesh and cancel the turn. Found under proposal.0007 in PR #42; out of scope because that proposal does not change session lifecycle."
```

The agent applies the project's existing types, priorities, labels, and dependency relationships when those conventions exist. Dependencies matter: an item blocked by another is linked so `bd ready` stays honest about what can actually be started.

When a newly discovered defect is relevant to the current pull request but intentionally outside its scope, the agent links the work item from the pull request or an appropriate review comment. This makes the decision to defer the defect explicit and leaves a durable path from the context in which it was discovered to the future work needed to resolve it.

If subsequent work fixes the defect incidentally, the agent closes the item with a reference to the pull request or commit that resolved it rather than leaving it stale.

Durable project knowledge — a constraint learned the hard way, a decision too small for a record but too costly to rediscover — goes in `bd remember`, not a memory file.

## Completion

Once the feature has passed human review, the agent completes the authorized integration and delivery work.

### Vision Update

The agent reviews the project vision and updates it when the completed feature changes the project's current capabilities, minimum viable product, or broader direction.

Because the vision is intended to describe the project as it currently exists and where it is heading, accepted work should not leave it stale.

The agent may consult the human before making substantial changes to the vision.

### Changeset

Every pull request carries a changeset. `mise run changeset` writes one into `.changeset/`, naming the bump and describing the change for the changelog a user will read — not for the reviewer who already saw the diff. A change with no user-visible effect still carries a changeset, created with `--empty`. CI rejects a pull request without one; the release pull request is exempt.

### Implementation Record

After acceptance and the vision update, set the proposal to `implemented` in the feature pull request before merging it. This records the approved implementation, not integration or release. Keep acceptance and outstanding delivery visible in the proposal or pull request. Verify the updated integration candidate; do not open a follow-up pull request solely to change the proposal status.

Confirm the status record is in the pull request revision, not only the local checkout, before marking a draft pull request ready or merging. If an earlier pull request has already merged, inspect its merged revision before concluding a local `accepted` status means the record is missing. Report an absent record to the human for reconciliation rather than treating a merged pull request as editable or opening a status-only pull request.

### Merge

The agent merges the accepted pull request into the project's main branch after confirming that the implementation record is in its latest revision and its checks are fresh. If the pull request remains draft, mark it ready and verify the updated revision before merging.

The merge should preserve enough information for future humans or agents to recover what was proposed, what was implemented, why important decisions were made, what problems were discovered during review, what changes were requested, and how the final implementation differs from earlier revisions.

The proposal and relevant pull request history therefore form part of the long-term knowledge base of the project rather than disposable development scaffolding.

### Release

Merging accumulates changesets on the main branch. `mise run version` applies the pending changesets: `changeset version` bumps the version in the root `package.json`, writes `CHANGELOG.md`, and `mise run version:sync` carries that version into `Config/Version.xcconfig` so the two cannot drift.

This project has no publish target, no release workflow, and no deploy step, so merge-only delivery is the normal case and there is nothing further to perform. A project that acquires a published artifact adds its release path through a proposal. When a release does exist and is required, the human must explicitly authorize it: merge approval alone does not authorize publication. `implemented` records accepted implementation in the feature pull request, not a completed release.

### Dependent Work

If other projects contain draft pull requests depending on a preview version of the feature, the agent updates those pull requests to consume the production release.

Once their dependency on unreleased work has been removed, the agent marks those dependent pull requests as ready for review when appropriate.

This allows work across multiple repositories to be developed against previews without leaving those preview dependencies in place after release.

### Cleanup

After required delivery, the agent cleans up temporary files, preview configuration, and stale feature branches only with the relevant authorization. A worktree created for the feature is removed with `wt` once its pull request is merged.

Branch deletion and published-artifact teardown require explicit human confirmation. Cleanup is a separate operation, not an automatic result of merging or setting `implemented`.

## Process Summary

At the project level:

**vision → feature proposals → implemented project → updated vision**

For each feature:

**human opts into proposal → branch → draft pull request → grounding and ontology review when needed → baseline study → proposal → tests → guides → code → validation → self-check → adversarial review → preview → ready pull request → human review → revision or acceptance → vision update → changeset → implemented record in the feature pull request → merge → required release → dependent updates → authorized cleanup**

The central invariant of the process is that no single artifact defines the feature by itself.

The proposal records intent. Tests encode behavior. Guides explain behavior. Code implements behavior. Previews expose behavior for direct inspection. Independent agent review attempts to find contradictions and defects. Human review determines whether the result is actually the feature that was intended.

Each representation acts as a check on the others.
