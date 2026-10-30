# Platform notes

Checked against official documentation on 2026-10-22. Goal and skill behavior is evolving; re-check your harness's documentation when its version changes.

## Cross-harness rules

A goal contract has to survive being read by a harness that neither you nor the author chose. The portable contract is:

1. Keep the complete, finite closure set inline in the goal.
2. Use referenced files as execution context, not as an unbounded definition of "done."
3. Name one outcome, fixed acceptance criteria, exact proof, meaningful constraints, and explicit stop states.
4. Require decisive command results and artifact evidence to be surfaced in the conversation.
5. Add a turn/no-progress escape clause.
6. Keep the body at or below 4,000 characters; target 3,000 or fewer as this skill's conservative headroom heuristic.

Some harnesses permit putting longer instructions in a file and pointing the goal at it. That is useful for implementation context, but a pointer-only completion condition is not portable: a goal evaluator generally cannot read the file independently, and a large document often has no finite closure boundary. Keep the spec external and the closure contract inline.

The 3,000-character target, 3-turn stagnation rule, and 10/20/30-turn caps in this skill are conservative authoring defaults, not documented platform limits. The only hard length limit shared across the harnesses that document one is 4,000 characters.

## Where a harness has a goal command

Harnesses that ship a persistent-goal command converge on the same shape, and these are the properties a contract may rely on:

- The goal is a durable objective attached to one session; setting a new one replaces the old, and lifecycle controls pause, resume, edit, or clear it.
- The objective must be non-empty and no longer than 4,000 characters.
- A separate, usually smaller model evaluates the condition against the conversation after eligible turns. It does not run commands or read files independently.
- Effective conditions have one measurable end state, a stated check, and constraints that must hold.
- A goal does not widen tool permissions; unattended work may need a separate approval mode.
- Goal state carries budget accounting. Reaching a budget limit is distinct from completing the objective.
- The goal clears when the evaluator judges the condition met or impossible, or when a failure needs the human.
- Where completion must be decided by deterministic custom logic rather than a model reading the transcript, a stop hook is the better mechanism.

Practical implications:

- Make the worker print the exact test, build, or inspection evidence in its final turn. "The file now contains X" is weaker than a surfaced command result or bounded inspection output.
- Label the contract's terminal `BLOCKED` outcome in the transcript, including the incomplete criteria. An evaluator's achieved-or-impossible verdict does not replace that report.
- A `PLAN.md` or spec can guide implementation, but the goal freezes the subset of outcomes that closes this particular run. For a large plan, write sequential goal contracts rather than one "implement the plan completely" loop.
- `SUCCESS` and `BLOCKED` label report outcomes. Use a harness's native status controls only under its own authority and timing rules; an incomplete objective must never be marked complete merely to stop continuation.

## Where a harness has no goal command

Oh My Pi has no persistent-goal command. The contract is still the useful artifact: it is the brief handed to a `task` subagent or to a long-running delegated run, and the same closure set, proof commands, constraints, and stop states apply. Without a native evaluator, the orchestrator reads the final report and decides, so the requirement to surface decisive evidence matters more, not less.

## Agent Skill packaging

The skill follows the open Agent Skills directory format:

```text
compiling-agent-goals/
├── SKILL.md
├── assets/
├── references/
└── scripts/
```

`SKILL.md` stays below the recommended 500-line and 5,000-token budgets, while detailed material is loaded progressively from references.

This copy is vendored into the repository at `.agents/skills/compiling-agent-goals/`, where any harness that discovers `.agents/skills/` finds it. There is no installation step.

Official sources:

- <https://agentskills.io/specification>
- <https://agentskills.io/skill-creation/best-practices>
