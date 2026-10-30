# Agent Contract

This project uses the **Workbench** development process. [`PROCESS.md`](PROCESS.md) is the full description; this file is the operative contract. Read it before doing anything substantial.

Workbench has two governing principles:

1. **Understanding precedes intent; intent precedes implementation.** Before deciding what to build, understand the problem on its own terms. Before writing code, make the intended behavior explicit.
2. **No single artifact defines a feature by itself.** A proposal records intent, tests encode behavior, guides explain behavior, code implements behavior, and a preview exposes behavior. Each is an independent check on the others.

You do not move directly from a request to a solution, or from a solution to an implementation.

## Start here, every session

```sh
mise run status   # phase, next action, who acts
bd prime          # the work graph and what is ready
```

`status` reads the branch, the pull request, and the active proposal's status, then prints which phase the work is in and what happens next. `bd prime` loads the Beads workflow context and any persistent memories. Run both before asking the human where things stand, and run them again whenever you are unsure.

The human is never expected to remember a command, a skill name, or an argument. "Keep going", "start a feature for X", or a plain description of a problem is enough to orient from `mise run status`. None of those phrases authorizes a proposal or draft pull request.

## Reasoning order

For substantial work, reason in this order:

```text
reality → understanding → conceptual model → intent → implementation → verification
```

Do not collapse these stages.

- **Understanding** — learning the problem domain well enough to reason with its concepts, constraints, and standards of quality rather than generic software patterns.
- **Conceptual model** — deciding what kinds of things exist, what distinguishes them, how they relate, and which distinctions are fundamental rather than implementation conveniences.
- **Intent** — the reviewed decision about what this project should do, recorded in the proposal.
- **Implementation** — that intent realized in tests, guides, and code.

A plausible implementation plan is not evidence that the problem is understood.

## Artifacts

| Artifact | Lives in | What it is |
| --- | --- | --- |
| **Vision** | `VISION.md` | The project's purpose, MVP target, principles, and direction. Living document. |
| **Policies** | `policies/` | Rules that future work must keep enforcing. |
| **Decisions** | `decisions/` | Architectural choices, with the context that produced them. |
| **Proposals** | `proposals/` | The specification for one change. Preserved as history after it ships. |
| **Guides** | `guides/` | Human-facing prose explaining how a feature behaves and how it is used. |
| **Work items** | Beads (`bd`) | The work graph: ready work, blockers, follow-ups, and durable agent memory. |
| **Previews** | CI | The cheapest real artifact through which a human can exercise the change. |
| **Tests** | project-native | Executable specifications of the behavior a proposal describes. |
| **Code** | project-native | The implementation. |

Numbered artifacts use `<NNNN>-<slug>.md` and carry `id`, `status`, and `title` frontmatter. `.agents/templates/` holds the canonical shape of each. `mise run validate` enforces it.

[`PROTOTYPE.md`](PROTOTYPE.md) is an **implementation brief**, not one of these artifacts. It is the handoff context the session that builds the adapter starts from: the intended behavior, the acceptance criteria, and the evidence each claim requires. It is not an approved proposal, a bounded build mandate, or a grant of authority, and it does not shorten the path below. The adapter still enters the feature loop at the authority check, and its intent is recorded in a proposal reviewed by the human.

Every proposal is evaluated against the current vision, policies, and decisions. When they disagree with what you are about to build, stop and raise it — do not quietly deviate.

## Agent roles

Workbench distinguishes responsibilities even when one harness or model can technically perform all of them.

### Strategist

The primary agent is the strategist. It owns domain grounding, synthesis of evidence, problem formulation, ontology and conceptual modeling, product and architectural reasoning, proposal development, decomposition and delegation, resolving strategic conflicts discovered during implementation, and the final quality pass.

The strategist must understand the problem well enough to judge the work it delegates. Delegation is not a substitute for understanding.

### Implementer

An implementer receives a bounded, already-understood piece of work and realizes it in tests, guides, and code.

It may make local implementation decisions, but it does not silently redefine domain concepts, product behavior, proposal intent, or architecture owned by the strategist.

If implementation evidence contradicts the supplied model of the problem, return that conflict to the strategist rather than encoding a new answer.

### Reframer

A reframer is an independent reasoning agent used when the current formulation of the problem appears wrong or repeated local work stops increasing confidence.

It challenges premises, boundaries, abstractions, and diagnoses. It is not merely a more powerful implementer.

### Adversary

The adversary receives fresh context and attempts to falsify the finished work. It reports defects and proposal gaps; it does not fix them.

## Bounded build mandates

A human-approved build mandate delegates decisions for a bounded outcome to the strategist. Within its recorded authority, it replaces per-feature human consent, proposal approval, and acceptance or merge gates throughout this contract and the linked skills. Outside that authority, the individual human-approval path remains in force.

Record the mandate in a `## Build mandate` section of an ordinary proposal. It must specify:

- the outcome, observable completion criteria, scope, and non-goals;
- fixed constraints, including trust boundaries and compatibility promises;
- delegated decisions and actions, naming any permission to create PRs, push feature branches, accept work, and merge into a particular target branch;
- resource and spending limits, with no new spending authorized by omission;
- required verification, independent review, and preview evidence;
- an expiry or completion condition;
- dated human approval and retrievable evidence of the approved revision.

The mandate proposal requires human approval and cannot authorize itself. Missing approval, unresolved boundaries, expiry, completion, or revocation means no delegated authority. The human alone may extend or renew the mandate, change its boundaries, or grant additional actions. Permission to establish this mechanism does not activate a runtime build mandate.

Each governed proposal carries an `## Authorization` section linking the mandate and its approved revision, explaining why the change fits, and recording the strategist's approval decisions. Ordinary proposals record direct human consent instead. Workers receive that reference with their bounded brief; Beads task state and an agent's assertion of authority do not replace it.

For covered work, the strategist is the approval owner. It may choose and revise in-scope behavior, settle technical tradeoffs, authorize proposals as `awaiting-implementation`, and record in-scope policies and decisions without another human round trip. It must update intent before deriving tests, guides, and code. Implementers still return strategic conflicts to the strategist.

Delegated acceptance requires the readiness report, applicable fresh checks and smoke evidence, the required independent reviews, and an exercised preview. The strategist may then set `accepted` and perform an explicitly authorized PR merge. An implementer's own completion claim is insufficient. Unresolved defects, missing mandated outcomes, and disputed material review findings block autonomous acceptance. Serialize integration and verify the latest integration candidate before merging; earlier branch checks do not prove the combined result.

An in-scope uncertainty belongs to the strategist. A change to the mandate's boundaries or an uncertainty about authority belongs to the human: block the affected slice, record the question and evidence in Beads and the PR, and continue unrelated authorized work. Agents must not weaken security, remove a promised outcome, relax verification, or edit the mandate to manufacture permission.

Merge authority does not grant public publication, production deployment, credential or access changes, branch deletion, force-push, or other destructive operations. Those require explicit human authorization for the action. Direct pushes to the default branch remain prohibited. `implemented` records the accepted implementation in the original feature pull request before merge; required delivery remains outstanding until separately authorized and performed, while a merge-only proposal needs no release.

Human instructions override delegated authority immediately. Recheck the mandate before approval and integration decisions, and revert to individual human approval when it no longer applies.

## The feature loop

```text
human consent or active mandate → branch → draft PR
       → grounding → baseline study → proposal
       → tests → guides → code → validation
       → simplification and hardening → inline reviews → cross-artifact review → adversarial review
       → preview → readiness report
       → approval-owner review → revision → vision update → implemented record in feature PR → authorized merge/delivery → cleanup
```

Grounding and baseline study are part of proposal development, not separate proposal statuses. Use them when the problem requires substantive conceptual understanding; do not manufacture research ceremony for a trivial or already-understood change. Numbered phases below follow [`PROCESS.md`](PROCESS.md). Agent review is the end of implementation, not a phase of its own.

**Scale the process to the change.** What follows is written for substantial work — new or changed behavior, anything where a reasonable person could build it differently. A typo, a dead link, or a bug whose correct behavior was never in question is not that: fixing it is faster than describing it, and it often needs no pull request either.

Lean on one question: **does this change decide something?** If intent already exists because a proposal promised the behavior or the contract is obvious, correct the implementation directly, and say in a line which you think it is and why before you start. For substantial work, check the bounded build mandate first; if it authorizes the change, record that authority and proceed. Otherwise ask the human whether they want a proposal before opening a branch or draft PR — a request to "start a feature" or "write a proposal" alone does not grant consent.

Individual consent covers that change and its revisions. If the human declines, do not create its proposal or draft PR. Proceed directly when intent is unambiguous; clarify consequential choices with the approval owner before implementing. A small fix that reveals a design choice returns to this authority check.

### 1. Preparation

After establishing direct human consent or applicable mandate authority, create a branch, push it to `origin`, and open a **draft** pull request before writing the proposal. The PR is the durable workspace for the proposal, implementation, review discussion, and status reports. It stays a draft until the agent believes the work is ready.

Use `wt` for a feature that runs in parallel with other work; the worktree gets its own ports, dependencies, and `mise` environment, and shares the Beads database with the main checkout.

### 2. Grounding and Proposal

A proposal records a decision. It should not be the place where an agent first discovers what the problem means.

#### 2A. Ground the problem

Before proposing a solution, determine whether the change depends on domain knowledge that cannot safely be inferred from the request alone. When it does, use `.agents/skills/grounding-a-problem/` and learn enough of the domain to reason about the problem on its own terms.

Prefer authoritative and primary evidence, and keep four categories distinct: **established knowledge** (authoritative external evidence or direct observation), **repository evidence** (actual code, tests, behavior, interfaces, history), **inference** (drawn from evidence but not established by it), and **hypothesis** (still to be tested). Agent-generated analysis never becomes established knowledge merely because another agent repeats it.

Do not begin this stage by producing an implementation plan. The goal is to become capable of judging proposed solutions for domain-specific reasons.

#### 2B. Review the ontology when the change is concept-heavy

When the work introduces or changes important concepts, identities, relationships, states, classifications, ownership, or vocabulary, use `.agents/skills/ontology-review/`: ask what kinds of things actually exist in the problem domain before deciding how software should represent them. It is not required for every proposal — use it when a mistaken conceptual model would materially distort APIs, data, UI, behavior, or architecture. Material findings feed back into the proposal, or into grounding if the grounding itself was wrong.

#### 2C. Study the existing baseline

Only after grounding the problem, inspect the closest existing implementation, prototype, workflow, prior art, or earlier attempt. Treat it as a specimen: identify what behavior or insight is valuable; identify compromises, accidental complexity, and incorrect assumptions; preserve what expresses the problem well; do not mistake implementation details for properties of the domain.

Existing code is evidence, not authority.

#### 2D. Write the proposal

Then write `proposals/<NNNN>-<slug>.md` and push it to the draft pull request as soon as it is coherent enough to react to.

The proposal records the problem and motivation; the grounded context required to evaluate it; the relevant existing baseline; the proposed solution; detailed intended behavior; scope and exclusions; compatibility and adoption implications; alternatives and unresolved questions.

The human and agent iterate until the intent is right. The proposal stays `status: draft` throughout. The approval owner decides when it is settled and moves it to `status: awaiting-implementation`.

Skills: `.agents/skills/grounding-a-problem/`, `.agents/skills/ontology-review/` when applicable, `.agents/skills/writing-a-proposal/`.

### 3. Implementation

The strategist retains responsibility for the meaning of the work. Implementers realize bounded parts of it.

For each delegated slice, the strategist supplies enough context for an implementer with no prior conversation history to work correctly: the bounded behavior to implement; relevant Detailed design; domain concepts and constraints necessary to understand it; the quality bar established during grounding; the relevant baseline; governing policies and decisions; explicit scope and non-goals; verification commands. `.agents/skills/compiling-agent-goals/` turns that into a written brief when the handoff is large or repeated.

An implementer must not infer missing product intent. Implementation may return:

- `DONE` — the bounded work is complete and verified.
- `DONE_WITH_CONCERNS` — complete, but observations deserve strategist review.
- `NEEDS_CONTEXT` — execution requires missing information.
- `NEEDS_STRATEGY` — implementation evidence contradicts or destabilizes the supplied conceptual model, intended behavior, or architecture.
- `BLOCKED` — progress cannot continue under the current constraints.

`NEEDS_STRATEGY` returns ownership to the strategist. Do not respond by telling the implementer to guess.

Strict artifact order holds, and it ends with review. Each artifact is an independent representation of the same intent; writing them out of order lets the code decide what "correct" means.

1. **Tests first.** Failing tests for the behavior the proposal's Detailed design specifies.
2. **Guides next.** User-facing docs written from the proposal, not from the code. Then compare them against the tests and confirm they describe the same behavior.
3. **Code last.** Implement against proposal, tests, and guides until `mise run check` passes.

**Which of these a change needs is a judgement.** The order is not — when you write two of them, write them in this order. But a change with no user-visible surface needs no guide, and inventing one produces documentation nobody reads describing behavior nobody sees. A change with nothing meaningfully testable needs no test, though say so out loud rather than skipping quietly, because "hard to test" and "not worth testing" are different claims and only one of them is a reason.

Passing the quality gates is necessary, never sufficient. Then, still within this phase:

4. **Simplify.** Once the feature works, the strategist uses `.agents/skills/simplifying-code/`: structure that fights the domain model, implementation conveniences leaking into public behavior, false distinctions the working system exposed, complexity inherited from the baseline. Ask not whether it works, but whether this is the implementation that should remain.
5. **Harden.** Then `.agents/skills/hardening-changes/` runs scoped independent review over the owned change and fixes what it finds. An invariant claim — "this state is unreachable", "this value cannot be constructed invalid" — routes to `.agents/skills/verifying-invariants/` for evidence rather than assertion.
6. **Inline reviews** — review proposal compliance, then code quality. Resolve findings before advancing.
7. **Cross-artifact review** — read proposal, tests, guides, and code together and find where they disagree.
8. **Adversarial review** — an independent subagent with fresh context and preferably a different model tries to falsify the claim that the work is done.
9. **Preview**
10. **Readiness report**

Skills: `.agents/skills/implementing-a-proposal/` owns steps 1–6; `.agents/skills/reviewing-an-implementation/` owns steps 7–10 and dispatches `.agents/skills/adversarial-review/` for step 8.

A preview is keyed to what the repository _is_, not to a fixed mechanism: a library ships a prerelease package; a web app or API a preview deployment; a docs site a deployed build; a CLI an installable executable; a desktop or mobile app an installable build through an ad-hoc or internal track. Pico's previews are the adapter itself, launched by a real Sesh session, and the companion app, launched and clicked through — see [Platform](#platform-bun-acp-adapter-and-mac-companion-app).

### 4. Approval review

The approval owner reviews the report, the diff, and the preview. A human reviewer comments on the PR; they may also commit directly. When feedback changes the intended design rather than correcting its implementation, **update the proposal first**, then re-run phase 3 against it.

Their verdict sets the status: `returned-for-revisions` to send it back, `accepted` to take it.

### 5. Completion and release

Update `VISION.md` if the feature changed what the project is, add a changeset for the change, record `implemented` on the accepted feature pull request before merge and verify that revision, then merge, complete any separately authorized required release, update dependent projects, and perform authorized cleanup. Skill: `.agents/skills/completing-a-feature/`.

## Reframing hard problems

Do not confuse repeated activity with increasing understanding.

Use `.agents/skills/reframing-a-problem/` when evidence suggests the current formulation itself may be wrong, including when:

- repeated fixes expose new contradictions;
- several locally reasonable approaches fail for apparently unrelated reasons;
- implementation requires violating grounded domain constraints;
- a supposedly simple concept requires persistent special cases;
- the current abstraction makes the domain unnaturally difficult to express;
- an implementer returns `NEEDS_STRATEGY`;
- the strategist can describe symptoms but no coherent causal model.

The reframer receives the grounding, proposal, evidence, attempted approaches, and concrete failures and independently challenges the premises. It does not silently change product intent. Its result returns to the strategist, who decides whether to revise grounding, ontology, proposal, architecture, or implementation.

Use systematic debugging when the intended behavior is sound and the implementation is failing. Use reframing when the model of the problem itself may be wrong. When neither resolves it and the decision belongs to the human, use `.agents/skills/writing-escalation-briefs/` instead of another attempt.

## Hard rules

- **Never substitute planning for understanding.** A task list, architecture sketch, or plausible implementation strategy does not establish that the underlying problem is understood.
- **Never let generated knowledge recursively become evidence.** Agent synthesis remains inference until supported by authoritative evidence, repository evidence, or direct verification.
- **Never use an existing implementation as the sole source of domain truth when independent domain knowledge is available.** Ground the problem first; then inspect the implementation.
- **Never silently encode an ontology decision.** If implementation changes what kinds of things exist, their identity, relationships, lifecycle, states, or vocabulary, route that decision upstream.
- **Never let an implementer redefine product intent or architecture merely to make implementation easier.** Return strategic conflicts to the strategist.
- **Never create a proposal, feature branch, or draft PR for the proposal path without authority for this change** — explicit human consent, or a mandate that covers it. Do not infer consent from the size of a request, a command's suggested next step, or a request to "start a feature". [`PROTOTYPE.md`](PROTOTYPE.md) is not that authority.
- **Never implement substantial work without an approved proposal.** Approval comes from the human or the strategist exercising recorded mandate authority. Corrections and fixes with unambiguous intent are not substantial work.
- **Never write production code before its failing test.** If the behavior warrants a test at all and you wrote the code first, delete it and start over.
- **Never write guides from the finished code.** When a change warrants a guide, it is derived from the proposal. Whether it warrants one is a judgement; the direction of derivation is not.
- **Never claim work is done without running the verifying command this turn** and reading its output. See [`.agents/rules/verification.md`](.agents/rules/verification.md).
- **Never fix a bug before finding its root cause.** Skill: `.agents/skills/systematic-debugging/`.
- **Never let the adversarial reviewer edit code.** It reports; the implementer fixes.
- **Never merge, publish, change access, or perform a destructive operation without authority for that action.** A mandate may explicitly delegate PR merges; it does not implicitly authorize release, branch deletion, or force-push.
- **Never expand approved scope silently.** Revise the proposal before behavior changes. The strategist may approve revisions within the mandate; only the human may change the mandate's boundaries. A discovered defect is not a licence to widen the work.
- **Never file a work item to defer work the proposal already requires.** Fix it.
- **Never ship a change without a changeset.** `--empty` is allowed when the change has no user-visible effect; CI rejects the pull request without one.

## Policies and decisions

When a feature establishes a rule future work must keep enforcing, record a **policy**. When it establishes an architectural choice future work must understand, record a **decision**. Establish approval with the human or under the mandate's delegated authority before writing them; neither is a substitute for a proposal, and neither may silently change the mandate's constraints.

**Most features establish neither, and that is the normal case.** The test is whether the knowledge outlives the change: if it does not, it belongs in the proposal and nowhere else. Both directories being empty is a healthy state, not a gap to fill. A record written speculatively is one nobody follows and everybody has to read.

A policy that can be enforced by a check should be — see [`.agents/rules/enforcement-hierarchy.md`](.agents/rules/enforcement-hierarchy.md). Prose is the tier most likely to be missed.

Skill: `.agents/skills/completing-a-feature/`.

## Work tracking

Beads (`bd`) is the work tracker, the ready-work queue, and durable agent memory. It replaces GitHub-issue defect tracking, markdown TODO lists, and MEMORY files. Proposals and Beads answer different questions: the proposal is the record of **intent**, reviewed by a human and preserved as history; Beads is the **work graph** — what is ready, what is blocked, what was discovered and deferred, and what a future session needs to remember.

```sh
bd ready                 # what can be worked on now
bd show <id>             # read one item before touching it
bd update <id> --claim   # claim atomically before starting
bd create "Title" --description="why this exists" --type=task --priority=2
bd close <id> --reason="Completed"
bd remember "<fact>"     # durable project memory
```

Rules that matter:

- Never run `bd edit`; it opens an interactive editor and will hang a non-interactive agent. Use `bd update` flags.
- Priorities are `0`–`4`, `0` highest. Default `2`. Do not invent a scale.
- Claim before starting and close only when the work is actually done.
- Never run `bd hooks install`; hk owns the git hooks and runs `bd hooks run <hook>` as a step.
- `.beads/issues.jsonl` is a passive export that is committed; the database is the source of truth.

A defect that stops the current implementation from satisfying its proposal is **not** a new work item. It is the current work, and it gets fixed. Skill: `.agents/skills/tracking-work/`.

## Quality gates

```sh
mise run setup       # idempotent first-run bootstrap after copy or clone
mise run check       # the single blocking gate; CI and the pre-push hook both call it
mise run fmt         # format in place; accepts file paths
mise run lint        # lint
mise run typecheck   # type-check in strict mode
mise run test        # tests
mise run validate    # record frontmatter, IDs, and cross-references
mise run status      # phase, next action, who acts
mise run changeset   # add a changeset for this change
```

`mise run check` is the gate. Nothing is done until it passes in this turn. `mise tasks` lists everything available, including the platform tasks below.

## Tooling

**Mise** owns toolchains, environment, and the task graph. Every command an agent runs routinely is a `mise run <task>`; `mise install` provisions the pinned toolchains from `mise.toml` and `mise.lock`. Add a task rather than documenting a bare command — a task is an enforceable tier, prose is not.

**hk** owns every git hook. `mise run setup` installs them with `hk install --mise`. Never install hooks any other way, and never bypass them with `--no-verify`.

**Beads (`bd`)** owns the work graph and agent memory. See [Work tracking](#work-tracking).

**Changesets** owns the changelog and versioning. `mise run changeset` adds one; `mise run version` applies the pending changesets to `package.json` and `CHANGELOG.md`. Every pull request carries a changeset.

**Worktrunk (`wt`)** owns worktrees. `wt switch --create <name>` creates a parallel worktree that trusts and installs its own toolchain and copies the ignored files listed in `.worktreeinclude`. Run parallel feature work in a worktree rather than stashing. That is unrelated to the Sesh child sessions the adapter will delegate to.

**GitHub Actions** runs the same `mise run check` the pre-push hook runs. If it passes locally and fails in CI, the difference is environmental — find it, do not special-case the workflow.

<!-- BEGIN PLATFORM -->

## Platform: Bun ACP adapter and Mac companion app

Pico is two programs. One is a Bun/TypeScript [ACP](https://agentclientprotocol.com) agent that exposes an [OMP](https://omp.sh) SDK agent to Sesh. The other is a native macOS app that installs, configures and inspects it, so the user never opens a terminal. **Neither is written.** Nothing in this repository speaks ACP, loads the OMP SDK, runs an agent, or draws a window; the process above is how either gets written.

[`PROTOTYPE.md`](PROTOTYPE.md) is the implementation brief: the behavior to build, the acceptance criteria, and the evidence each claim requires. It is input to proposal development — the baseline and much of the grounding are already in it — not a substitute for the proposal. [`VISION.md`](VISION.md) carries the purpose and the deliberate exclusions.

What the Mac app has is project configuration: a Tuist project definition, a target with no sources, and the toolchain pinned to generate it. A project that generates proves the configuration is valid. It does not prove an app exists. The session that writes the app adds its sources, points the target at them, and adds the tasks that build, test and launch it, with the code.

### Where the APIs come from

The OMP side is the published SDK, `@oh-my-pi/pi-coding-agent`, documented at [omp.sh/docs/sdk](https://omp.sh/docs/sdk). Use public exports only; the brief says what to do when a needed hook is missing from them. The installed package's type declarations outrank any summary, including this one.

The ACP side is the official TypeScript SDK and the protocol at [agentclientprotocol.com](https://agentclientprotocol.com). Implement against the version actually negotiated with the client and against the SDK's types, not against a remembered shape of the protocol.

Sesh is a client you can run. Its tool names, its MCP surface, its child-session behavior, and its rendering are observed from the running application, never assumed. The References section of [`PROTOTYPE.md`](PROTOTYPE.md) lists the documentation for all three sides.

The Mac app is Swift 6 against Apple's own frameworks: SwiftUI, with AppKit where SwiftUI cannot express the control. No webview shell, no cross-platform UI toolkit. Target the API documented for the deployment floor rather than fencing off something newer.

Provider configuration uses public OMP SDK authentication and model-registry APIs. Use its OAuth/device flows and API-key support; offer only models and reasoning levels available through the configured engine. Do not build a second provider integration layer or assume every provider offers a live catalog endpoint. Existing credentials remain user-owned, and Sesh setup uses its supported GUI/API path with permission.

### Layout

| Path | What lives there |
| --- | --- |
| `PROTOTYPE.md` | the implementation brief for the adapter and the Mac app |
| `tools/` | zero-dependency TypeScript scripts run by Bun: the Workbench workflow scripts and commit checkers |
| `.omp/extensions/` | harness lifecycle wiring: the gate on stop, formatting after an edit, `bd prime` |
| `mise.toml` | the task graph — every routine command |
| `hk.pkl` | every git hook |
| `.github/workflows/ci.yml` | CI, running the same `mise run check` |
| `tsconfig.json` | strict TypeScript for the whole repository |
| `Project.swift` | the Mac app's project definition: target, bundle identifier, deployment target, build settings |
| `Tuist.swift` | marks the repository root for Tuist |
| `Config/Version.xcconfig` | app version projection and build number; `version:sync` writes `MARKETING_VERSION` from package.json |
| `.swift-format` | the Swift formatter's configuration |

Neither program has a source directory. The proposal that introduces the adapter decides where its code lives; the proposal that introduces the app adds the app's sources and points the `Pico` target at them. Each adds the tasks that run its code, with the code.

### Commands

Every tool runs through a mise task; `package.json` has no `scripts` block.

| Task | Does |
| --- | --- |
| `mise run setup` | frozen dependency install, Beads initialization, then `hk install --mise` |
| `mise run deps:install` | install dependencies from the committed lockfile |
| `mise run fmt` | format with Oxfmt in place |
| `mise run lint` | lint with Oxlint, applying safe fixes |
| `mise run typecheck` | type-check with `tsc` in strict mode |
| `mise run test` | run the tooling and skill-helper suites with Bun |
| `mise run validate` | check record frontmatter, IDs, and cross-references |
| `mise run status` | phase, next action, who acts |
| `mise run changeset` | add a changeset for this change |
| `mise run check` | the blocking gate — what CI and `pre-push` run |
| `mise run macos:generate` | generate `Pico.xcodeproj` and `Pico.xcworkspace` from `Project.swift` |
| `mise run macos:open` | generate the project and open it in Xcode |
| `mise run macos:fmt` | format the Swift manifests in place |
| `mise run macos:lint` | check Swift formatting without rewriting it |
| `mise run macos:check` | the native configuration gate: formatting, generation, and the build settings `xcodebuild` resolves |
| `mise run macos:clean` | remove the generated project and Tuist's artifacts |
| `mise run version:sync` | write the version `package.json` carries into `Config/Version.xcconfig` |

`mise run check` runs the Bun suites and `macos:check`, then `hk check --all` and `mise run validate`. The native check skips on non-macOS hosts, so Linux retains the workflow gate; CI also exercises native configuration in a dedicated macOS job.

There is no `dev`, `build`, `start`, or `acp` task because there is no executable yet, and no `macos:build`, `macos:test` or launch task because the app has no sources to compile. There is no release or deploy task at all. Add the task with the thing it runs, not before.

### Runtime

Bun is the only JavaScript/TypeScript runtime, package manager, and test runner required by this repository. It runs `tools/`, skill helpers, their tests, and the future ACP adapter. The Bun lockfile and exact dependency versions remain committed.

Existing `node:*` imports, including `node:test`, use Bun's compatibility implementations and do not require an external Node executable. Preserve supported APIs rather than rewriting working filesystem or subprocess code for a naming change. Use Bun for helper subprocesses and force package CLI execution through Bun so installed `node` shebangs cannot select a system runtime.

`tools/check-scoped-commit.ts` is the tooling pattern: small modules, exported pure functions, and colocated behavioral tests. Workbench and Beads retain their existing responsibilities.

Bun leaves lifecycle scripts for the transitive `onnxruntime-node` and `protobufjs` dependencies blocked; the package imports work with those scripts blocked, and `mise run setup` grants no blanket script trust. Optional native features have not been exercised — establish what a given feature needs before unblocking anything.

### Native app

One macOS target, `Pico`, bundle identifier `me.malstrom.pico`, deployment target macOS 14. No iOS target or Mac Catalyst. Swift 6 uses complete strict concurrency and `ExistentialAny`. The prototype does not configure App Sandbox integration or an entitlements file; the planned app uses a local helper and explicit access to existing OMP configuration.

`Project.swift` is the source of truth; Tuist generates the Xcode project from it and the generated `.xcodeproj` and `.xcworkspace` are ignored. Tuist is pinned in `mise.toml` and installs on macOS only; `swift`, `swift format`, `xcodebuild` and `xcrun` come from the selected Xcode rather than from mise. Nothing is signed: `CODE_SIGNING_ALLOWED` is `NO`, and there is no distribution or notarization path here.

The configured deployment floor is macOS 14, matching CodexBar's documented minimum. The packaged engine's compatibility with that floor remains unverified; do not claim older-system support until the complete runtime is exercised there.

[`PROTOTYPE.md`](PROTOTYPE.md#native-macos-configuration-app) carries the app's design: the System Settings layout, the CodexBar-shaped provider and account configuration, what the app bundles, and how configuration reaches a session. It is the one place that design lives. Do not restate it here, in a second brief, or in a new skill.

### Preview

Pico's preview is the adapter itself: an installable or runnable stdio executable that the human launches from a real Sesh session and exercises. The companion app's preview is a build the human launches and uses; a generated Xcode project is not one, and neither is a screenshot of a view that sets nothing. Until there is something runnable there is nothing to preview, and the readiness report says so plainly rather than substituting a transcript. A green `mise run check` proves the repository is clean, not that either program functions.

### Hard rules

- **Never fabricate a capability.** A tool the adapter advertises must do what its description says, and a feature that is not implemented is absent from the tool list rather than present and inert. The same holds in the app: a switch, a picker, or a status row that reports nothing real does not ship.
- **Never fall back silently.** When a model, a tool, a session, or a transport fails, the failure reaches the client with its cause. A stub that returns a plausible success is worse than an error.
- **Every agent-requested tool execution and delegated session is visible through ACP.** Report a shell operation's subprocess activity within its tool call rather than inventing separate calls for engine internals.
- **Never rewrite the user's global OMP configuration, credentials, or existing terminal sessions.** Apply Pico's policy per process and per session over the user's normal configuration, reuse credentials without copying them, and persist only Pico-owned session history. Registering or changing the user's active Sesh agent needs permission.
- **Never claim the prototype works without running it.** The evidence is a real Sesh session driving this adapter, exercising the behavior, and the output read in the same turn.
- **Never add Python or JavaScript eval, a built-in language server or automatic LSP hooks, or OMP's native task, agent and workpool delegation.** [`VISION.md`](VISION.md) carries the reasoning. Code intelligence comes from the user's own `intellisense` CLI through a visible execution tool, and delegation goes through real Sesh child sessions.
- **No build-tool wrappers.** Oxfmt, Oxlint, tsc, Bun and Tuist are invoked directly by mise tasks, and `swift format` comes from the selected Xcode. Do not add ESLint, Prettier, Biome, SwiftLint, a second Swift formatter, a `scripts` block, or a second task graph.
- **Scripts are TypeScript with zero dependencies**, with their tests beside them. No shell or Python scripts.
- **Never edit the generated `.xcodeproj` or `.xcworkspace`.** The next generation overwrites them and they are not in git. Change `Project.swift`.
- **Never add placeholder Swift source to make something build.** A stub `@main` type, an empty view, or a settings screen wired to nothing is worse than a source-free target, because it looks like progress. The target stays source-free until the real app replaces it.
- **Never manufacture credentials or model availability.** Use public OMP SDK authentication and model-registry APIs, with explicit GUI feedback when a supported account or model is unavailable.
- **Never invent a Sesh registration API.** Register through the path Sesh supports, with the user's permission, or leave registration to the user.
- **Never hand-edit `MARKETING_VERSION`.** `mise run version` writes `Config/Version.xcconfig` from the Changesets version through `mise run version:sync`.

<!-- END PLATFORM -->

## Also binding

- [`.agents/rules/code-quality.md`](.agents/rules/code-quality.md) — what good code looks like here.
- [`.agents/rules/commit-discipline.md`](.agents/rules/commit-discipline.md) — commits, staging, push and PR policy.
- [`.agents/rules/enforcement-hierarchy.md`](.agents/rules/enforcement-hierarchy.md) — where a new rule belongs.
- [`.agents/rules/verification.md`](.agents/rules/verification.md) — what evidence a completion claim requires.

### Skills

Every skill lives in `.agents/skills/<name>/`. Process, in phase order:

- `writing-a-proposal` — a change needs definition before tests, guides, or code.
- `implementing-a-proposal` — an approved proposal needs tests, guides, code, and inline review.
- `reviewing-an-implementation` — implementation is complete and the representations must be compared.
- `adversarial-review` — finished work needs an independent attempt to falsify it.
- `completing-a-feature` — accepted work needs records, merge, release, and cleanup.

Reasoning, whenever the situation calls for it:

- `grounding-a-problem` — the change depends on domain knowledge you cannot safely infer from the request.
- `ontology-review` — important concepts, identities, relationships, states, or vocabulary change.
- `reframing-a-problem` — the current formulation of the problem stops explaining the evidence.
- `systematic-debugging` — intended behavior is sound but the implementation is wrong and the cause is unknown.
- `engineering-for-change` — deciding how a design absorbs change, or whether an abstraction earns its cost.
- `compiling-agent-goals` — a delegated slice needs a written brief a fresh agent can execute.
- `writing-escalation-briefs` — a decision belongs to the human and another attempt will not help.

Craft, during and after implementation:

- `reviewing-code` — reviewing a change read-only, including as a dispatched reviewer.
- `simplifying-code` — the feature works; is this the implementation that should remain?
- `hardening-changes` — an owned change set needs scoped independent review and the fixes it produces.
- `verifying-invariants` — a claim that some state is unreachable or some value cannot be constructed needs evidence.
- `writing-technical-prose` — writing or auditing guides, READMEs, records, and other human-facing prose.
- `tracking-work` — discovered work must be filed, claimed, or deliberately deferred.

There is no platform skill. The web platform's skills were removed with the web application; the ACP, OMP SDK and Sesh documentation the adapter is built against is listed in [`PROTOTYPE.md`](PROTOTYPE.md). A skill for this platform is itself a change that needs a proposal.
