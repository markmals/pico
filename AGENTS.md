# Agent Contract

This project uses the **Workbench** development process: intent is approved in a proposal, agents implement it as tests, guides, and code, and an independent review checks them against each other before the human reviews the result. [`PROCESS.md`](PROCESS.md) is that loop in full; the skills named below hold the procedures.

```sh
mise run status   # phase, next action, who acts
bd prime          # the work graph and what is ready
```

Run both at the start of every session and whenever you are unsure where the work stands. The human need not remember a command or a skill name: "keep going" or a plain description of a problem is enough to orient from. Neither authorizes a proposal or a draft pull request.

## Does this change need a proposal?

Ask one question: **does this change decide something?**

- If intent already exists — an approved proposal promises the behavior, or the correct behavior is obvious (a typo, a dead link, a bug whose fix is unambiguous) — implement it directly. Say which case it is, in one line, before you start.
- If the change decides something, you need the human's explicit yes to "do you want a proposal for this change?". Only then create a branch, push it to `origin`, open a **draft** pull request, and write the proposal with [`.agents/skills/writing-a-proposal/`](.agents/skills/writing-a-proposal/). A request to "start a feature" or to "write a proposal" is not that yes, and neither is `mise run status` output. Consent covers that change and its revisions, not the next one.
- If a small fix turns out to need a design decision, stop and ask the proposal question then.

[`PROTOTYPE.md`](PROTOTYPE.md) is an **implementation brief**, not an approved proposal and not that yes. It is the handoff context the session that builds the adapter starts from: the intended behavior, the acceptance criteria, and the evidence each claim requires. The adapter still enters at the question above, and its intent is recorded in a proposal the human approves.

Proposal status belongs to the human. They set `awaiting-implementation` from `draft`, and `accepted`, `returned-for-revisions`, or `rejected` from `active-review`. You set `active-review` when you hand finished work over, and `implemented` in the accepted pull request before merge ([`.agents/skills/completing-a-feature/`](.agents/skills/completing-a-feature/)).

## Implementing an approved proposal

Use [`.agents/skills/implementing-a-proposal/`](.agents/skills/implementing-a-proposal/). In short:

1. Read the proposal's Detailed design and the code it touches.
2. Write failing tests for the behavior Detailed design specifies, and watch each fail for the missing behavior.
3. When the change alters what a user does, sees, or must know, write or extend the guide in `guides/` from the proposal, not from the code, and compare it with the tests.
4. Write the code.
5. Verify with `mise run check` and any project gate `mise tasks` lists that it does not cover. Report the commands you ran and what they printed.
6. Hand off to [`.agents/skills/reviewing-an-implementation/`](.agents/skills/reviewing-an-implementation/): self-check against the proposal, take one independent review and fix what it confirms, produce the preview, then post the readiness report, move the proposal to `active-review`, and mark the pull request ready — together.

Which of tests, guides, and code a change needs is a judgement; the order is not. A change with no user-facing surface needs no guide and an untestable one needs no test, but say so rather than skipping quietly.

Implement inline by default. Delegate only slices that are independent, touch separate files, and save real time in parallel, plus the fresh-context reviewer that has not seen your reasoning. A slice's brief carries the behavior, relevant Detailed design, constraints, scope, and verification commands — [`.agents/skills/compiling-agent-goals/`](.agents/skills/compiling-agent-goals/) writes a large or reused one — and you integrate and commit the work. A slice reporting that the evidence contradicts the proposal's model stops there and goes to [`.agents/skills/reframing-a-problem/`](.agents/skills/reframing-a-problem/).

## Rules

- **Stay inside the proposal.** Behavior it does not describe does not get built; if it should exist, revise the proposal with the human. A defect outside its scope becomes a Beads item ([`.agents/skills/tracking-work/`](.agents/skills/tracking-work/)); one that stops the proposal working is your work.
- **Raise ambiguity.** When the proposal, vision, a policy, or a decision is ambiguous or conflicts with the work in a way that changes behavior, raise it rather than choosing silently.
- **Never substitute planning for understanding.** A plausible strategy is no evidence that the problem is understood; ground it first ([`.agents/skills/grounding-a-problem/`](.agents/skills/grounding-a-problem/)), and treat agent synthesis as inference until evidence verifies it.
- **Never silently encode an ontology decision.** If the work changes what kinds of things exist, their identity, relationships, states, or vocabulary, route it upstream ([`.agents/skills/ontology-review/`](.agents/skills/ontology-review/)).
- **Never write production code before its failing test**, when the behavior warrants a test. Wrote it first? Delete it and start from the test.
- **Never write a guide from finished code.**
- **Never claim work is done without running the verifying command this turn** and reading its output ([`.agents/rules/verification.md`](.agents/rules/verification.md)).
- **Find a bug's root cause before fixing it** ([`.agents/skills/systematic-debugging/`](.agents/skills/systematic-debugging/)).
- **The adversarial reviewer reports; it never edits.**
- **Never merge, publish, deploy, change access, delete a branch, or force-push without explicit human confirmation for that action.**
- **Never ship a change without a changeset**, `--empty` when there is no user-visible effect; CI rejects the pull request without one.
- **Record a policy or decision only after discussing it with the human.** Most features establish neither; a record earns its place only when its knowledge outlives the change, and a rule a check can enforce belongs in the check ([`.agents/rules/enforcement-hierarchy.md`](.agents/rules/enforcement-hierarchy.md)).

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

Pico is two programs. One is a Bun/TypeScript [ACP](https://agentclientprotocol.com) agent that exposes an [OMP](https://omp.sh) SDK agent to Sesh. The other is a native macOS app that installs, configures and inspects it, so the user never opens a terminal. **The adapter's core turn path exists** ([proposal 0001](proposals/0001-acp-adapter-core.md), guide [`guides/running-pico-in-sesh.md`](guides/running-pico-in-sesh.md)). It speaks ACP over stdio, runs OMP SDK sessions with the curated tool roster, reports every tool call, cancels turns, and offers model and thinking-level selection. **The Mac app is a UI scaffold**: it builds and launches a native settings window with six sidebar destinations, and every configuration control in it is a visibly unconnected stub ([proposal 0005](proposals/0005-mac-app-ui-workspace.md), guide [`guides/refining-the-mac-app-ui.md`](guides/refining-the-mac-app-ui.md)). It configures nothing yet. Session restore, delegation through Sesh child sessions and Autonomous sessions are follow-up proposals tracked in Beads.

The adapter ships as `pico`, a Bun single-file executable ([proposal 0002](proposals/0002-pico-homebrew-distribution.md)). Users install it with `brew install markmals/tap/pico`, a formula in the public tap `markmals/homebrew-tap` whose bottles the tap's CI builds. Homebrew is Pico's install path. `pico` keeps its own files (the extracted native addon and the model cache) in `~/Library/Application Support/Pico`.

[`PROTOTYPE.md`](PROTOTYPE.md) is the implementation brief: the behavior to build, the acceptance criteria, and the evidence each claim requires. It is input to proposal development — the baseline and much of the grounding are already in it — not a substitute for the proposal. [`VISION.md`](VISION.md) carries the purpose and the deliberate exclusions.

What the Mac app has is its window, its navigation, and six pane layouts, built from `app/` by the `Pico` target. A window that opens proves the layout; it does not prove a setting works, and none of them does: the app reads and writes no configuration, holds no credentials, discovers no models, launches no helper, and contacts no Sesh. Configuration functionality waits for the shared configuration contract in [issue #12](https://github.com/markmals/pico/issues/12); the session that connects these controls adds that behavior, its tests, and its guide with the code.

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
| `adapter/` | the ACP adapter: `pico.ts` (the compiled entry point: arguments, data directory, native addon), `main.ts` and stdout isolation, `server/` (ACP requests, sessions, config options), `events/` (engine events to ACP updates), `engine/` (OMP session construction, tool roster, MCP, write bridge), `smoke/` (the real-credential smoke run and the offline `pico:verify` check) |
| `app/` | the Mac app's Swift: `PicoApp.swift` and `Navigation/` (the window scene, the split-view navigation and its destinations), `Panes/` (the six settings-pane layouts), and `Localizable.xcstrings`, the string catalog the compiler extracts into |
| `tools/` | zero-dependency TypeScript scripts run by Bun: the Workbench workflow scripts, commit checkers, the adapter launcher writer, and `build-pico.ts`, which compiles `pico` and generates the third-party notices |
| `LICENSE`, `THIRD-PARTY-NOTICES.md` | Pico's MIT license, and the generated notices for everything `pico` bundles |
| `.omp/extensions/` | harness lifecycle wiring: the gate on stop, formatting after an edit, `bd prime` |
| `mise.toml` | the task graph — every routine command |
| `hk.pkl` | every git hook |
| `.github/workflows/ci.yml` | CI, running the same `mise run check` |
| `tsconfig.json` | strict TypeScript for the whole repository |
| `Project.swift` | the Mac app's project definition: target, sources and resources under `app/`, bundle identifier, deployment target, build settings |
| `Tuist.swift` | marks the repository root for Tuist |
| `Config/Version.xcconfig` | app version projection and build number; `version:sync` writes `MARKETING_VERSION` from package.json |
| `.swift-format` | the Swift formatter's configuration |

The adapter lives in `adapter/`, with tests beside the code. `mise run acp:launcher` writes `.build/pico-acp`, the development launcher that runs from source; `mise run pico:build` compiles `.build/pico`, the executable the Homebrew formula ships. The app's sources live in `app/`, and `Project.swift` points the `Pico` target at them with globs, so a file added there is picked up by the next generation. `mise run macos:build` compiles the Debug app into `.build/macos`, and `mise run macos:run` opens it.

### Commands

Every tool runs through a mise task; `package.json` has no `scripts` block.

| Task | Does |
| --- | --- |
| `mise run setup` | frozen dependency install, Beads initialization, then `hk install --mise` |
| `mise run deps:install` | install dependencies from the committed lockfile |
| `mise run fmt` | format with Oxfmt in place |
| `mise run lint` | lint with Oxlint, applying safe fixes |
| `mise run typecheck` | type-check with `tsc` in strict mode |
| `mise run test` | run the tooling, skill-helper and adapter suites with Bun |
| `mise run validate` | check record frontmatter, IDs, and cross-references |
| `mise run status` | phase, next action, who acts |
| `mise run changeset` | add a changeset for this change |
| `mise run check` | the blocking gate — what CI and `pre-push` run |
| `mise run acp:launcher` | write `.build/pico-acp`, the executable Sesh launches |
| `mise run acp:smoke` | drive `.build/pico-acp` through a real ACP session with your own OMP credentials |
| `mise run acp:tck` | check `.build/pico-acp` against the ACP compatibility kit |
| `mise run pico:build` | compile `.build/pico`; fails when `THIRD-PARTY-NOTICES.md` no longer matches what it bundles (rerun `bun tools/build-pico.ts --outfile .build/pico --write-notices`) |
| `mise run pico:verify` | run `.build/pico` offline with a scratch home: `--version`, `initialize`, and a turn through a project extension |
| `mise run pico:smoke` | drive `.build/pico` through a real ACP session with your own OMP credentials |
| `mise run pico:tck` | check `.build/pico` against the ACP compatibility kit |
| `mise run macos:generate` | generate `Pico.xcodeproj` and `Pico.xcworkspace` from `Project.swift` |
| `mise run macos:open` | generate the project and open it in Xcode |
| `mise run macos:fmt` | format the Swift manifests and `app/` in place |
| `mise run macos:lint` | check the formatting of the Swift manifests and `app/` without rewriting it |
| `mise run macos:build` | build the Debug `Pico.app` into `.build/macos` |
| `mise run macos:run` | build the app and open `.build/macos/Build/Products/Debug/Pico.app`, this checkout's copy |
| `mise run macos:check` | the native gate: formatting, generation, the build settings `xcodebuild` resolves, and a Debug build of the app |
| `mise run macos:clean` | remove the generated project and Tuist's artifacts |
| `mise run version:sync` | write the version `package.json` carries into `Config/Version.xcconfig` |

`mise run check` runs the Bun suites and `macos:check`, then `hk check --all` and `mise run validate`. The native check skips on non-macOS hosts, so Linux retains the workflow gate. CI's macOS job runs `macos:check` and `pico:verify` on the `xcode-27` runner image: building the app's macOS 27 floor needs the macOS 27 SDK, which `macos-latest` does not carry.

There is no `dev` or `start` task; the development launcher runs from source. There is no `macos:test` task: the scaffold has no behavior worth a test, and the running app is its layout and navigation check — native tests arrive with the functionality that warrants them. There is no release or deploy task either: a release is a `v<version>` tag on `main` after the Changesets version pull request, followed by a pull request to `markmals/homebrew-tap` that updates `Formula/pico.rb`. The tap's CI builds the bottles, and labelling that pull request `pr-pull` publishes them. Both the tag and the label are publishing, so each needs the human's explicit confirmation. Add the task with the thing it runs, not before.

### Runtime

Bun is the only JavaScript/TypeScript runtime, package manager, and test runner required by this repository. It runs `tools/`, skill helpers, the ACP adapter, and their tests. The Bun lockfile and exact dependency versions remain committed.

Existing `node:*` imports, including `node:test`, use Bun's compatibility implementations and do not require an external Node executable. Preserve supported APIs rather than rewriting working filesystem or subprocess code for a naming change. Use Bun for helper subprocesses and force package CLI execution through Bun so installed `node` shebangs cannot select a system runtime.

`tools/check-scoped-commit.ts` is the tooling pattern: small modules, exported pure functions, and colocated behavioral tests. Workbench and Beads retain their existing responsibilities.

Bun leaves lifecycle scripts for the transitive `onnxruntime-node` and `protobufjs` dependencies blocked; the package imports work with those scripts blocked, and `mise run setup` grants no blanket script trust. Optional native features have not been exercised — establish what a given feature needs before unblocking anything.

### Native app

One macOS target, `Pico`, bundle identifier `me.malstrom.pico`, deployment target macOS 27. No iOS target or Mac Catalyst. Swift 6 uses complete strict concurrency and `ExistentialAny`. The prototype does not configure App Sandbox integration or an entitlements file; the planned app uses a local helper and explicit access to existing OMP configuration.

`Project.swift` is the source of truth; Tuist generates the Xcode project from it and the generated `.xcodeproj` and `.xcworkspace` are ignored. Tuist is pinned in `mise.toml` and installs on macOS only; `swift`, `swift format`, `xcodebuild` and `xcrun` come from the selected Xcode rather than from mise. Nothing is Developer ID signed or notarized: the app's `CODE_SIGNING_ALLOWED` is `NO`, and `pico` carries only Bun's ad-hoc signature. Developer ID signing and notarization wait for a paid Apple Developer Program membership.

The app's configured deployment floor is macOS 27, the floor Mark chose for it ([proposal 0005](proposals/0005-mac-app-ui-workspace.md)). It belongs to the app alone: `pico`, the Homebrew executable, keeps its own supported range, and the packaged engine's compatibility with any floor remains unverified. Building the app therefore needs an Xcode carrying the macOS 27 SDK, which is why CI's macOS job names the `xcode-27` runner image instead of `macos-latest`.

What is built today is the UI scaffold from [proposal 0005](proposals/0005-mac-app-ui-workspace.md): the window, the sidebar navigation, and six pane layouts whose configuration controls are unconnected stubs. Window management, navigation and scrolling work; nothing else in the app does. [`guides/refining-the-mac-app-ui.md`](guides/refining-the-mac-app-ui.md) is how a human builds, runs and inspects it.

[`PROTOTYPE.md`](PROTOTYPE.md#native-macos-configuration-app) carries the app's design: the System Settings layout, the CodexBar-shaped provider and account configuration, what the app bundles, and how configuration reaches a session. It is the one place that design lives. Do not restate it here, in a second brief, or in a new skill.

### Preview

Pico's preview is the adapter itself: an installable or runnable stdio executable that the human launches from a real Sesh session and exercises. The companion app's preview is a build the human launches and uses; a generated Xcode project is not one, and neither is a screenshot of a view that sets nothing. For the UI scaffold that preview is `mise run macos:run` and the panes, navigation, scrolling, resizing, appearances and accessibility exercised in the running window — evidence about layout, never about configuration that works. Until there is something runnable there is nothing to preview, and the readiness report says so plainly rather than substituting a transcript. A green `mise run check` proves the repository is clean, not that either program functions.

### Hard rules

- **Never fabricate a capability.** A tool the adapter advertises must do what its description says, and a feature that is not implemented is absent from the tool list rather than present and inert. The same holds in the app, with one explicit exception: the approved UI scaffold ([proposal 0005](proposals/0005-mac-app-ui-workspace.md)) may show switches, pickers and status rows that are visibly unconnected — disabled, or reading “Not connected”, and announced that way to accessibility clients too — so their layout can be refined before [issue #12](https://github.com/markmals/pico/issues/12). A control that reports a value it does not have, or a save, a sign-in, a connection or any other operational success it did not perform, still does not ship.
- **Never fall back silently.** When a model, a tool, a session, or a transport fails, the failure reaches the client with its cause. A stub that returns a plausible success is worse than an error.
- **Every agent-requested tool execution and delegated session is visible through ACP.** Report a shell operation's subprocess activity within its tool call rather than inventing separate calls for engine internals.
- **Never rewrite the user's global OMP configuration, credentials, or existing terminal sessions.** Apply Pico's policy per process and per session over the user's normal configuration, reuse credentials without copying them, and persist only Pico-owned session history. Registering or changing the user's active Sesh agent needs permission.
- **Never claim the prototype works without running it.** The evidence is a real Sesh session driving this adapter, exercising the behavior, and the output read in the same turn.
- **Never add Python or JavaScript eval, a built-in language server or automatic LSP hooks, or OMP's native task, agent and workpool delegation.** [`VISION.md`](VISION.md) carries the reasoning. Code intelligence comes from the user's own `intellisense` CLI through a visible execution tool, and delegation goes through real Sesh child sessions.
- **No build-tool wrappers.** Oxfmt, Oxlint, tsc, Bun and Tuist are invoked directly by mise tasks, and `swift format` comes from the selected Xcode. Do not add ESLint, Prettier, Biome, SwiftLint, a second Swift formatter, a `scripts` block, or a second task graph.
- **Scripts are TypeScript with zero dependencies**, with their tests beside them. No shell or Python scripts.
- **Never edit the generated `.xcodeproj` or `.xcworkspace`.** The next generation overwrites them and they are not in git. Change `Project.swift`.
- **Never add Swift source whose only purpose is to make something build.** A type added to fill a file, or a view that exists so a target compiles, is worse than no file, because it looks like progress. The one approved exception is the UI scaffold ([proposal 0005](proposals/0005-mac-app-ui-workspace.md)): real, runnable layouts whose controls are deliberately unconnected, and which this contract, [`PROTOTYPE.md`](PROTOTYPE.md), the README and the guide all describe as unconnected. Anything beyond it — sample accounts, invented model catalogs, filters that appear to work, saves that appear to succeed — is the fabricated capability the first rule bans.
- **Never manufacture credentials or model availability.** Use public OMP SDK authentication and model-registry APIs, with explicit GUI feedback when a supported account or model is unavailable.
- **Never invent a Sesh registration API.** Register through the path Sesh supports, with the user's permission, or leave registration to the user.
- **Never hand-edit `MARKETING_VERSION`.** `mise run version` writes `Config/Version.xcconfig` from the Changesets version through `mise run version:sync`.

<!-- END PLATFORM -->

## Harness setup

The process lives harness-neutral in `AGENTS.md` and `.agents/`, which stay the source of truth and which no harness forks. Lifecycle wiring is the only harness-specific part, and this repository ships it for [Oh My Pi](https://omp.sh):

| What | How Oh My Pi gets it |
| --- | --- |
| This contract | Loads `AGENTS.md` from the repository root |
| Skills | Discovers `.agents/skills/` |
| Before the first turn | `.omp/extensions/prime-beads.ts` runs `bd prime` and injects the work graph and durable memories into the session |
| After every edit | `.omp/extensions/format-after-edit.ts` runs `mise run fmt -- <files>` on each file the `edit` or `write` tool changed and reports a reformat or a parse failure |
| Before the turn ends | `.omp/extensions/check-before-stop.ts` runs `mise run check`; a failure sends the agent back once with the output |

A harness without extensions loses only the convenience, not the rule: `bd prime` and `mise run check` are commands the agent runs itself, and hk's `pre-push` hook and CI run the gate regardless. Another harness wires the same three events into its own configuration and commits the result rather than forking `.agents/`.

Git hooks belong to hk, not to a harness: `mise run setup` installs them, and they run for every commit regardless of who or what made it.

## Also binding

- [`.agents/rules/code-quality.md`](.agents/rules/code-quality.md) — what good code looks like here.
- [`.agents/rules/commit-discipline.md`](.agents/rules/commit-discipline.md) — commits, staging, push and PR policy.
- [`.agents/rules/enforcement-hierarchy.md`](.agents/rules/enforcement-hierarchy.md) — where a new rule belongs.
- [`.agents/rules/verification.md`](.agents/rules/verification.md) — what evidence a completion claim requires.

### Skills

Every skill lives in `.agents/skills/<name>/`. Process, in phase order:

- `writing-a-proposal` — a change needs definition before tests, guides, or code.
- `implementing-a-proposal` — an approved proposal needs tests, guides, and code.
- `reviewing-an-implementation` — implementation is complete and needs its self-check, one independent review, the preview, and the handoff.
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
