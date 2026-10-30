---
name: implementing-a-proposal
description: Use when an approved proposal is ready for Phase 3 implementation, including a substantive bug fix whose root cause is known. Do not use for proposal authoring or trivial inline edits.
---

# Implementing a Proposal

Phase 3 preserves proposal intent in independent tests, guides, and code.

**Hard order when stages apply:** failing tests → guides → code → quality gates. Do not reverse, combine, or defer them.

## Preconditions

- The proposal has `status: awaiting-implementation`, or the human returned it for implementation with `status: returned-for-revisions`; neither has an unresolved clarification marker.
- Phase 1 — preparation — created the branch, pushed it to `origin`, and opened a draft pull request.
- Read the proposal's **Detailed design**, relevant vision, policies, decisions, affected tests, guides, and project conventions.
- Tests derive from **Detailed design**. Acceptance criteria are an occasional supplement, never the primary source.
- Raise a conflict or ambiguity. Do not silently choose behavior or expand scope; take it to the human.

## Who does the work

Implement the proposal yourself by default. One agent holding the whole change makes fewer handoff errors than a controller briefing subagents, and delegation does not make the work smarter.

Split the work only into slices that are independent, touch separate files, and save real time by running in parallel. Each brief carries the bounded behavior, the applicable Detailed design, the domain concepts, constraints, and quality bar needed to understand it, the relevant baseline, governing policies and decisions, explicit scope and non-goals, and the verification commands; [`.agents/skills/compiling-agent-goals/SKILL.md`](../compiling-agent-goals/SKILL.md) writes it when it is large or will be reused. Never dispatch two subagents onto the same files, and never split a coherent small change to manufacture concurrency. You integrate and commit the work; a subagent does not commit.

When a slice reports that the evidence contradicts the proposal's model, stop it and verify the conflict against domain evidence. Decide with the human whether to revisit grounding, ontology, or the proposal. Use [`.agents/skills/reframing-a-problem/SKILL.md`](../reframing-a-problem/SKILL.md) when repeated fixes stop explaining the evidence, and resume only after intent is settled and recorded.

## 1. Failing tests

### Iron Law

```text
NO TEST-WORTHY PRODUCTION BEHAVIOR WITHOUT A FAILING TEST FIRST
```

If you wrote test-worthy production code before its failing test, **delete it and start over**. Do not keep it as reference, adapt it while writing the test, or inspect it for the test design. **Delete means delete.**

When behavior warrants a test, that test is evidence only if you watched it fail for missing behavior. A test that first runs against finished code can describe what was built rather than what the proposal requires. If no behavior can be meaningfully tested, state why before writing code.

### Red → green → refactor

| Stage | Required action |
| --- | --- |
| **RED** | Write one focused test for one observable behavior from Detailed design. Name it idiomatically with the proposal id and behavior it verifies. |
| **Verify RED** | Run it. Confirm an expected assertion fails because behavior is missing — not because of setup, an import, or a typo. If it passes, correct the test. |
| **Guide** | For user-facing behavior, write the guide from the proposal and compare it with the failing test before writing code. |
| **GREEN** | Write the minimum production code that makes the test pass. Do not add untested defenses, future flexibility, or unrelated refactors. |
| **Verify GREEN** | Run the test and the relevant suite. Confirm they pass with no warnings, leaked logs, or skipped success. |
| **Refactor** | Remove duplication and improve the design while tests stay green. Add no behavior. For the next behavior, start again at RED. |

Never commit while red. At a green natural boundary, follow [`.agents/rules/commit-discipline.md`](../../rules/commit-discipline.md).

### Invariants require properties

An invariant uses universal language: **always**, **never**, **for any**, or **for all**. Its test **must be property-based**, not merely a collection of examples.

Examples prove only the inputs you imagined. A property exercises the required relation across generated valid inputs. The adversarial review flags an invariant covered only by examples because it targets the inputs those examples omit.

| Invariant | Required property |
| --- | --- |
| Blank after trimming is invalid | For all strings that trim to blank, validation rejects. |
| Round trip | For all valid values, `decode(encode(value))` equals the original value. |
| Idempotence | For all inputs, `normalize(normalize(value))` equals `normalize(value)`. |

Watch the property fail in RED. Keep clear example tests alongside it; they document boundaries and named cases. Do not force property testing on a single mapping, constant, or formatting rule with no universal claim.

### Stop and restart

| Red flag | Required correction |
| --- | --- |
| Test-worthy code exists before its failing test | Delete the code. Start again with RED. |
| A new test passes immediately | Correct the test until it fails for the required missing behavior. |
| A test errors before asserting behavior | Fix setup and rerun until the expected assertion fails. |
| “I will test after” or “keep this as reference” | Delete the code. Start again with RED. |
| Examples are the only coverage for an invariant | Add a failing property-based test before implementation. |

## 2. Guides

Not every change needs a guide. Ask whether it alters what a user does, sees, or must know. A workflow fix, an internal refactor, or a validator rule with no user-facing surface needs none, and writing one produces documentation describing behavior nobody observes. When in doubt, ask rather than manufacturing a guide to satisfy a list.

When a change does warrant one, write the interface as prose from the proposal before production code exists. That forces the behavior to be explainable independently of how it was built. A guide written from finished code documents whatever was implemented, including its accidents.

Write for someone who has never read the proposal and never will. Explain what they can do, what they observe, prerequisites, errors, and durable effects — not private data structures, control flow, file layout, or implementation rationale.

Guides live at `guides/<slug>.md`. Find the guide that already owns the workflow and extend it in the usual case. Add a guide only when no guide covers the workflow or combining them would make audience or behavior ambiguous. Do not duplicate overlapping instructions. Use [`.agents/templates/GUIDE.md`](../../templates/GUIDE.md) when adding a guide.

Preserve required guide frontmatter. Its `id` matches the path, `title` remains accurate, and `describes` preserves earlier proposal ids while adding the current one.

| Include | Exclude |
| --- | --- |
| Inputs, prerequisites, actions, outcomes, errors, constraints, defaults, and durable effects | Internal implementation details users cannot observe |
| Exact rules that tests exercise | Hedges that turn a tested rule into an option |
| Worked examples with real prerequisites | Invented, stale, copied, or destructive examples without a safe executable path |

Every worked example **must actually run** against the real interface exactly as printed. Correct it or remove it.

### Compare guides with tests — mandatory

Before any production code:

1. Read the proposal-derived guide and failing tests side by side when both exist.
2. List every behavior each artifact mentions.
3. Treat anything in one list and not the other as a defect in one of them.
4. Resolve every difference by correcting the guide, correcting the test, or revising the proposal with the human.
5. Only then treat the agreement as the contract the code must satisfy. When one artifact is inapplicable, compare the remaining one directly with Detailed design.

This comparison is load-bearing. Without it, the guide is decorative and the tests are an unreviewed interpretation. If a guide was written or rewritten from implementation, discard the code-shaped prose, derive it again from the proposal, and repeat the comparison.

## 3. Code

Implement only Detailed design and its applicable failing tests and guide. Keep the production change minimal; do not add behavior those artifacts do not require.

When a test is difficult to write, simplify the interface rather than compensate with excessive mocking or setup. Test real code; isolate only inputs you cannot control, such as network, time, or randomness.

If an unknown failure appears, stop implementation and use [`.agents/skills/systematic-debugging/SKILL.md`](../systematic-debugging/SKILL.md) to establish root cause before changing code.

## 4. Quality gates and commits

Run `mise run check`, then any project-specific gate `mise tasks` lists that it does not already cover, and read the output. Follow [`.agents/rules/verification.md`](../../rules/verification.md) for what counts as completion evidence. Never commit while red; commit at green boundaries and push.

Passing the gates is necessary, never sufficient. Red gates stop the work: never skip a gate, a review, or honest failing evidence, and never widen the proposal's scope from inside implementation.

## Then

Continue with [`.agents/skills/reviewing-an-implementation/SKILL.md`](../reviewing-an-implementation/SKILL.md). It owns the self-check, the one independent review, the preview, and the handoff to the human. Set no proposal status before then.
