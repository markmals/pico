---
name: engineering-for-change
description: Use when changing or reviewing software with state transitions, cross-boundary data, duplicated facts, confusable domain concepts, or consumers that may drift as requirements evolve.
---

# Engineering for Change

Optimize for software that remains correct as it changes. Passing tests today does not prove the model will resist the next edit. Apply the pattern proportionally: a local indexing fix needs no new domain type.

## Working pattern

1. **Find the rules.** Read relevant types, callers, tests, and contracts. Keep a private ledger of 1–5 important invariants: what must hold, where it is enforced, and how it is checked. Update it as facts change; do not create a repository document solely for this ledger.
2. **Represent the rules.** Use a discriminated union or equivalent when flags and nullable fields describe mutually exclusive states. Put data in the state that owns it; derive facts that would otherwise be stored twice. A `refundedAt` timestamp already encodes whether a refund occurred: adding `isRefunded` creates a second, disagreeing answer. Use distinct types for confusable IDs or units when mixing them is a real risk. Guard legal transitions in one place. Do not wrap every primitive or replace a working contract for aesthetic consistency.
3. **Check boundaries.** Validate network, storage, UI, CLI, filesystem, and foreign data before treating it as a domain type. A cast is not validation. If external writers or concurrent operations can bypass in-memory checks, use a database constraint, atomic transition, or equivalent enforcement.
4. **Trace the change outward.** Identify producers, direct readers, serializers, persisted data, and independently deployed consumers of the changed representation. Deliver the requested behavior in every in-scope consumer; migrate internal callers and tests with the change. For external clients that cannot deploy together, preserve their contract through a compatible representation or coordinated versioned rollout. If a required client cannot display the new behavior, report that blocker; do not call the feature complete and leave a known wrong display for a follow-up.
5. **Keep the change coherent.** If inspection reveals an independent bug in another workflow, describe the risk separately; fix it here only when it is necessary for the requested behavior or the user explicitly expands scope.
6. **Verify the model.** Inspect the final types and call sites for contradictory states, unsafe casts, duplicated truth, prohibited transitions, and regressions introduced during later edits. Exercise success, rejection, boundaries, and late/concurrent results where relevant. Run applicable checks; distinguish actual results from inspection.

## Quick reference

| Symptom | First move |
| --- | --- |
| Several flags with optional state-specific data | One tagged state carrying its own data |
| Two mutable copies of a fact | Store the source and derive the other (e.g., refund state from `refundedAt`) |
| External input asserted to a domain type | Validate at the ingress |
| Correct core, wrong downstream display | Migrate readers or preserve/version their contract |

For a TypeScript state example and language-specific patterns, read [references/type-patterns.md](references/type-patterns.md) when needed.

## Before finishing

| Temptation | Reality |
| --- | --- |
| “The core helper works; consumers can follow later.” | A known wrong UI or export is still a failed feature. |
| “Adding a field cannot break anyone.” | A required field breaks external constructors; an optional field may still be ignored or misread by older clients. |
| “This type passes, so the invariant holds.” | Runtime boundaries and concurrent writes still need enforcement. |
| “The neighboring bug uses the same primitive, so fix both in the hotfix.” | A separate workflow deserves its own reviewed change; report it without expanding the request. |

Final answer: state the delivered behavior, material design tradeoff, checks actually run, and any unresolved blocker. Keep the invariant ledger in working context, not in the user report.
