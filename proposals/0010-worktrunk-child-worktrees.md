---
id: proposal.0010
title: Worktrunk Worktrees for Child Sessions
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/55
issues: []
supersedes: []
---

# Worktrunk Worktrees for Child Sessions

## Summary

Before a Pico child session starts, Pico creates its worktree with Worktrunk: a new branch from the parent's last commit, set up by the project's blocking `pre-start` hooks. A failed creation fails the launch. Unchanged worktrees are removed when the child's turn ends. OMP's own worktree handling is turned off.

## Motivation

Mark delegates implementation work from a Pico parent to Sesh child sessions. Today Sesh creates each child's worktree, which has three problems for that work:

- **The child starts from the wrong commit.** Sesh branches a child from the project's default branch unless the launch names another, so a child of a parent working on a feature branch doesn't see the parent's committed work.
- **The child starts before the worktree is ready.** A fresh Sesh worktree has no toolchain trust, installed tools or dependencies. The child spends its first turn on setup, or fails at its first build or test.
- **Worktrees pile up.** A child that changed nothing leaves its worktree and branch behind.

Mark already uses [Worktrunk](https://worktrunk.dev) (`wt`) for worktrees, and this repository already configures Worktrunk hooks in `.config/wt.toml`. Worktrunk can branch from the current HEAD (`--base=@`), runs the project's blocking `pre-start` hooks before it returns, and gives agents a structured result to read. Worktrunk's [agent integration page](https://worktrunk.dev/claude-code/) says harnesses without worktree-lifecycle hooks, oh-my-pi among them, call `wt switch --create` and `wt remove` directly. Pico is one of those harnesses.

Separately, OMP's own worktree handling is still active in Pico's `bash` tool and is broken in the shipped executable (see [Existing baseline](#existing-baseline)).

## Domain grounding

### Established context

- **Worktrunk 0.81.0** (pinned in `mise.toml`, and in homebrew-core as `worktrunk`). Facts below are from `wt --help` and from probes run on 2026-11-09 in a scratch repository with an isolated `HOME`:
    - `wt switch --create <branch> --base=@ --no-cd --format=json` creates the branch from the invoking worktree's current HEAD and its worktree at the path from the `worktree-path` template. It runs `pre-start` hooks in the new worktree and waits for them (blocking). Then it starts `post-start` hooks in the background and prints one JSON object on stdout: `{"action":"created","branch":…,"path":…,"created_branch":true,"base_branch":…}`. Hook output goes to stderr.
    - The default `worktree-path` puts a worktree beside the main checkout as `<repo>.<branch>`: a worktree created from this repository's Sesh worktree landed at `~/Developer/Playgrounds/pico.probe-sesh-inplace`. `{{ repo_path }}` is the main checkout even when `wt` runs in another worktree. `worktree-path` is a user setting. In a project's `.config/wt.toml` it's ignored with a warning. `--config-set 'worktree-path="…"'` overrides it for one run. `wt list` marks a worktree that isn't at the path the user's own template gives with ⚐, and `wt step relocate` offers to move it there.
    - Project hooks (`.config/wt.toml`) need approval the first time they run and again whenever their command changes. In a non-interactive run, an unapproved hook makes `wt switch` exit 1 before anything is created ("Cannot prompt for approval in non-interactive environment"). `--yes` skips the prompt for that run and saves nothing. `wt config approvals add` saves approvals in the user's `~/.config/worktrunk/approvals.toml`, keyed by repository path.
    - A `pre-start` hook that fails makes `wt switch` exit with the hook's status. **The new worktree and branch stay behind.**
    - `wt remove` refuses a worktree with uncommitted or untracked files unless `--force`. It deletes the branch only when the branch adds nothing to the **default branch** (`-D` forces deletion), and runs in the background unless `--foreground`. A clean child branched from a feature branch therefore keeps its branch under a plain `wt remove`.
    - `wt merge [target]` squashes, rebases and fast-forwards the current worktree's branch into the target (the default branch unless named), then removes the worktree.
- **Sesh 1.0** `start_session` takes `project` (a name or a folder), `prompt`, `name`, `reportBack`, `baseBranch`, `inPlace` and `agent` ([Sesh docs](https://sesh.codes/docs/agents-that-start-sessions/), and the live schema). Observed on 2026-11-09: a launch with `project` set to a Worktrunk worktree of this repository and `inPlace: true` started a child whose working directory was the worktree, on the worktree's branch, recorded under the right parent, with `project` resolved to the main repository. `list_sessions` and `wait_for_sessions` report each session's `cwd`, `parentSessionId` and `state` (`working`, `idle`, `needsInput`, `error`, `stopped`).
- **OMP SDK 18.14.0** cannot set the folder a native subagent starts in. A `before_subagent_spawn` handler can return only `model`, `block`, `reason` and `note`. A `tool_call` handler can rewrite a tool's input, but the `task` schema has no folder field, only `isolated`. This is moot for Pico, which has no native subagents.
- **Homebrew:** `worktrunk` 0.81.0 is a bottled homebrew-core formula. It conflicts with `wiredtiger`, because both install `wt`.

### Relevant constraints and principles

- **One delegation backend.** Pico delegates only through Sesh child sessions ([VISION.md](../VISION.md)); OMP's native task, agent and workpool delegation stay excluded. This proposal changes where a child's worktree comes from, not what a child is.
- **Fail closed.** In a git repository, if a worktree can't be created, no child starts. A child never silently runs in an unisolated checkout.
- **Explicit integration.** Child changes reach the parent only through a deliberate action ([PROTOTYPE.md](../PROTOTYPE.md#delegation-through-child-sessions)). Pico never merges a child.
- **Visibility.** Everything Pico does to the user's repository on the agent's behalf shows in the ACP tool stream, with its cause when it fails.
- **No approvals, no new authority.** Pico never asks the user to approve anything ([proposal 0001](0001-acp-adapter-core.md)). The agent already has unrestricted shell access in the repository it delegates in, so running that repository's own hooks gives it nothing it didn't have.

### Quality bar

A child that Pico launches into a git repository starts in a worktree branched from its parent's last commit, with the project's `pre-start` setup finished, or doesn't start at all. Every failure names its cause and leaves no half-made worktree. A worktree is removed only when its child is no longer working and it holds nothing a person could want. Anything with commits or uncommitted files is never removed by Pico.

### Remaining uncertainty

- Whether archiving a child in Sesh does anything to a worktree Sesh didn't create. This design doesn't depend on it.
- Whether Sesh's report to the parent can arrive before `list_sessions` shows the child as settled. If it can, cleanup happens one parent turn later than it could; nothing is removed early.

## Existing baseline

- **Delegation.** [Proposal 0003](0003-pico-only-child-sessions.md) adapts Sesh's `start_session` into the tool Pico admits (`constrainSeshDelegation`, `adapter/engine/sesh-delegation.ts`). The adapted tool hides the `agent` field, rejects any launch that supplies one, and otherwise forwards the launch unchanged. Sesh creates the worktree. That adapter is the one place a child launch passes through, so it's where worktree creation belongs. Keep its agent rejection, its schema checks and its receiver-preserving proxy.
- **OMP worktree handling in Pico.** The only OMP worktree feature live in a Pico session is `worktree.clone`. Under `picoSettings()` it resolves to `true`, so OMP's `bash` tool rewrites a `git worktree add …` command into `<executable> worktree add …`. In the compiled `pico`, that executable is `pico` itself, and `pico worktree add` fails with `INVALID_ARGUMENT: pico has no command "worktree"` (both halves observed on 2026-11-09). Task isolation (`task.isolation.enabled`, off) and session worktrees (`worktree.onStart`, interactive only) never run in Pico.
- **This repository's Worktrunk config.** `.config/wt.toml` runs `mise trust` and `mise install` as blocking `pre-start` hooks. `wt step copy-ignored` (which copies `node_modules`) and `mise run setup` (which installs dependencies) run as background `post-start` hooks, so a new worktree isn't ready when `wt switch` returns.
- **Distribution.** `Formula/pico.rb` in `markmals/homebrew-tap` declares `depends_on "bun" => :build`, `arch: :arm64` and `macos: :sonoma`, and no runtime dependencies ([proposal 0002](0002-pico-homebrew-distribution.md)).

## Proposed solution

When a Pico parent launches a child, Pico's adapted `start_session` creates the worktree itself with Worktrunk. The worktree branches from the parent's last commit, and the project's `pre-start` hooks finish before Pico asks Sesh to start the child in place in that folder. When the parent has uncommitted changes, or Worktrunk fails, the launch fails and no child starts. At each parent turn boundary, Pico removes the worktrees of children whose turn has ended and which changed nothing. Worktrees with work in them stay for review and `wt merge`.

```text
parent (clean, on feature/x) → start_session(project, prompt) → wt creates pico/<name>-<id> from feature/x, pre-start hooks run → Sesh child starts in that worktree
parent with uncommitted changes → start_session(…) → failed call: commit or discard first; no child
pre-start hook fails → failed call with the hook's error; the half-made worktree is removed; no child
child's turn ends, nothing changed → next parent turn removes its worktree and branch
child's turn ends with commits → worktree and branch stay
```

## Detailed design

### OMP's worktree handling is off

Pico's isolated settings set `worktree.clone` to `false`. A `git worktree add` command in `bash` runs git unchanged, in the source launcher and in the compiled executable. No other OMP worktree setting changes.

### Which launches get a worktree

The adapted `start_session` keeps proposal 0003's behavior: a launch that supplies `agent` fails before anything else happens. For every other launch:

- **`inPlace: true`:** the caller has explicitly asked for the project's own checkout. Pico forwards the launch unchanged and creates no worktree.
- **Otherwise:** Pico resolves the target checkout, then creates the worktree as below.

**Resolving the target checkout.** `project` is a name or a folder:

- A folder is used as given.
- A name is resolved through Sesh's own project list (the `list_projects` operation of the same Sesh connection). A name Sesh doesn't know fails the launch, and the error names it.

If the folder belongs to the same git repository as the parent's working directory (same git common directory), the target checkout is the **parent's working directory**. That makes "the parent's HEAD" the parent's own branch, not whatever the repository's main checkout has checked out. A folder in another repository is its own target checkout.

**A folder outside any git repository** can't have a worktree. Pico forwards the launch to Sesh unchanged, as Sesh handles non-git projects today: the child runs in that folder. The call's result says the child has no worktree because the folder isn't a git repository. Pico records nothing for it, so cleanup never touches it.

### Uncommitted changes

Without a `baseBranch` in the launch, the worktree starts from the target checkout's HEAD. If that checkout has staged changes, unstaged changes to tracked files, or untracked files that aren't ignored, the launch fails before Worktrunk runs. The failed call names the checkout and says its uncommitted changes wouldn't reach the child: commit or discard them, then launch again. Pico never commits, stashes or discards anything itself.

With an explicit `baseBranch`, the caller chose the starting point, so this check doesn't apply.

### Creating the worktree

Pico runs Worktrunk with the target checkout as its working directory:

```text
wt switch --create <branch> --base=<base> --no-cd --yes --format=json
```

- `<base>` is `@` (the checkout's current HEAD), or the launch's `baseBranch` when it has one.
- `<branch>` is `pico/<slug>-<suffix>`. `<slug>` is the launch's `name`, lowercased with every run of characters other than `a–z` and `0–9` replaced by one `-`, trimmed of leading and trailing `-`, and cut to 40 characters. It's `child` when there's no name or the result is empty. `<suffix>` is 6 random lowercase hex digits.
- The worktree goes in a hidden `.worktrees` folder beside the main checkout, named `<repo>.<branch>`: Pico passes `--config-set 'worktree-path="{{ repo_path }}/../.worktrees/{{ repo }}.{{ branch | sanitize }}"'`, whatever the user's own Worktrunk setting says. For example, `~/Developer/Playgrounds/pico` gets children at `~/Developer/Playgrounds/.worktrees/pico.pico-review-auth-1a2b3c`. Worktrunk creates `.worktrees` when it's missing.
- `--yes` approves the project's hook commands for this run only and saves nothing in the user's Worktrunk approvals. Without it, any project with hooks would fail every launch, because the child can't answer an approval prompt. It grants the agent nothing it couldn't already run (see [Relevant constraints](#relevant-constraints-and-principles)).
- The project's `pre-start` hooks run before `wt` returns, so their setup is finished before the child starts. `post-start` hooks run in the background, as Worktrunk always runs them, and may still be running when the child starts. Projects that need setup finished before the child works put it in `pre-start`.

Worktrunk's progress and hook output stream into the `start_session` call as it runs. Pico reads `path` and `branch` from the JSON on stdout and records the **starting commit**: the new branch's tip after creation.

Pico finds `wt` on its `PATH`, then at `/opt/homebrew/bin/wt`.

### Starting the child

Pico forwards the launch to Sesh with `project` set to the worktree's path, `inPlace: true` and `baseBranch` removed. `prompt`, `name`, `reportBack` and anything else the host defines go through unchanged. The call's result is Sesh's result, plus the worktree's path and branch.

### Failures

Each of these is a failed `start_session` call that names its cause, and no child starts:

- **`wt` not found:** the error says Worktrunk is missing and how to install it (`brew install worktrunk`).
- **`wt` exits non-zero:** the error includes its exit status and error output, such as an unapproved or failing hook, an existing branch, or a bad `baseBranch`.
- **Unreadable `wt` output:** a run that exits 0 but whose stdout isn't the expected JSON.
- **Sesh refuses or fails the launch** after the worktree exists.
- **Cancellation** while Worktrunk is running: Pico stops `wt` and its hooks, and the call ends as cancelled.

In every case where a worktree or the new branch might exist (a failed hook, unreadable output, Sesh failing, cancellation), Pico removes both, forcibly, before the call ends. Nothing has worked in them yet. If that removal fails too, the error also names the path and branch left behind.

### Records

For each child worktree, Pico records with the parent session's private history (Application Support, as in [proposal 0004](0004-session-restoration.md)): the repository, the worktree's path, its branch and its starting commit. A parent that Pico reloads or resumes after a restart keeps its records, so cleanup continues.

### Cleanup when a child's turn ends

At the start and at the end of every parent turn, and when the parent session closes, Pico checks each recorded worktree:

1. **Already gone** (for example, removed by `wt merge`): Pico drops the record.
2. **Child still active:** Pico finds the child in Sesh's session list by working directory equal to the worktree's path. If its state is `working` or `needsInput`, Pico leaves the worktree and keeps the record. A child that is `idle`, `stopped` or `error`, or that is no longer listed, has **finished its turn**.
3. **Finished and unchanged:** "Unchanged" means no staged, unstaged or untracked-but-not-ignored files, and the branch tip still equals the starting commit. Pico removes the worktree and the branch, running in the foreground with deletion forced and hooks approved for the run (the project's `pre-remove` hooks run). Then it drops the record. A follow-up message to that child afterwards fails, because its folder is gone. Further work means a new child.
4. **Finished with changes:** Pico leaves the worktree and branch for the user to review and integrate, and drops the record. Pico never removes it later.

Each removal shows in the ACP stream as its own tool call, naming the worktree and branch, with its outcome. A failed removal is a failed call with its cause. Pico keeps the record and tries again at the next boundary. If Sesh's session list isn't available, Pico removes nothing, and the check shows as a failed call saying why.

### Guidance

Pico's guidance tells the parent:

- children start in a new worktree, on a new branch from this session's last commit, so commit before delegating anything the child needs to see;
- a launch from a checkout with uncommitted changes fails;
- a child's committed work stays on its branch for deliberate integration;
- an unchanged child's worktree is removed after its turn ends, so give each child a complete task.

The adapted tool's description says the same in one sentence.

### This repository's Worktrunk config

`.config/wt.toml` runs all setup as blocking `pre-start` hooks, in order: `mise trust --yes`, `mise install`, `wt step copy-ignored`, then `mise run setup`. Nothing remains in `post-start`. A worktree is ready for `mise run check` when `wt switch` returns.

### Distribution

`Formula/pico.rb` gains `depends_on "worktrunk"` in the tap pull request for the first release that includes this change, so every Homebrew install of Pico has `wt` at `/opt/homebrew/bin/wt`. The formula's `test` block is unchanged.

## Compatibility

- A Pico child now starts from its parent's last commit instead of the project's default branch. A child of a parent on `main` sees no difference in starting point.
- A launch from a parent with uncommitted changes, without `baseBranch`, now fails instead of starting a child that can't see those changes.
- A launch in a project whose Worktrunk hooks fail now fails, where Sesh would have started the child anyway.
- Child worktrees live in `../.worktrees/<repo>.<branch>` beside the main checkout instead of Sesh's worktree folder, and their branches are `pico/…` instead of Sesh's. Sesh still shows the child under its parent, in the right project. A user whose own Worktrunk `worktree-path` differs sees Pico's worktrees marked ⚐ in `wt list`; setting the same template in `~/.config/worktrunk/config.toml` removes the mark.
- Explicit `inPlace: true` launches, launches into folders outside any git repository, launches with `agent` (still rejected), and every other Sesh operation are unchanged.
- `git worktree add` through `bash` runs git directly. In the compiled `pico` it used to fail; in the source launcher it used to go through OMP's clone-first `omp worktree add`.
- The Homebrew formula's new dependency can't be installed alongside homebrew-core's `wiredtiger`, which also installs `wt`.

## Implications on adoption

- Pico needs Worktrunk. Homebrew installs it with `pico`; a development checkout gets it from `mise install`. Without it, child launches fail with an error saying so. Nothing else in Pico changes.
- Projects that want their children set up before they start define `pre-start` hooks in `.config/wt.toml`. A project without hooks gets a plain worktree.
- No migration is needed. Worktrees Sesh created for earlier children are untouched.
- Reverting restores Sesh-created worktrees. Branches and worktrees Pico left with changes stay until the user removes them.

## Scope

- Turn off `worktree.clone` in Pico's isolated settings.
- Create worktrees with Worktrunk in the adapted `start_session`: target resolution, the uncommitted-changes refusal, branch naming, streamed progress, every failure path and its cleanup.
- Record child worktrees with the parent's history, and the turn-boundary cleanup with its ACP reporting.
- Update Pico's guidance and the adapted tool's description.
- Move this repository's setup hooks into `pre-start`.
- Add `depends_on "worktrunk"` to the tap's formula at the next release.
- Update [`guides/running-pico-in-sesh.md`](../guides/running-pico-in-sesh.md), `AGENTS.md` (the Worktrunk and platform paragraphs), `README.md`, and [PROTOTYPE.md](../PROTOTYPE.md#delegation-through-child-sessions), which currently say Sesh owns child worktrees.
- Include a changeset.

### Out of scope

- **OMP native subagents.** They stay excluded ([VISION.md](../VISION.md)). The OMP extension API also can't set a subagent's folder (see [Domain grounding](#established-context)).
- **Merging child work.** Integration stays a deliberate action by the parent or the user (`wt merge`, or git).
- **Committing, stashing or snapshotting the parent's changes.** Mark chose refusal over each of these on 2026-11-09.
- **Writing hooks into other projects,** or approving their hooks beyond a single run.
- **Showing Worktrunk's presence or version in the Mac app's readiness checks.**
- **Changing Sesh, or children of non-Pico parents.**

## Preview

- Artifact: the source launcher (`mise run acp:launcher`, `.build/pico-acp`) from this branch, registered in Sesh as the existing Pico (dev) agent. The launcher must reach `wt` (on its `PATH` from mise, or `/opt/homebrew/bin/wt`).
- Reason: delegation and cleanup only exist with a real Sesh parent and child. The source launcher exercises the actual tool path without a release.
- Exercise, in a disposable git repository whose `.config/wt.toml` has a `pre-start` hook that writes a marker:
    - launch a child from a clean parent on a feature branch, and check it starts from that commit in `../.worktrees/<repo>.<branch>`, with the marker already present;
    - launch from a dirty parent, and see the refusal and no child;
    - make the hook fail, and see the failed launch with no leftover worktree or branch;
    - let an idle child that changed nothing get cleaned up at the next parent turn;
    - let a child commit something, and check its worktree and branch stay.
- Completion cleanup: remove the disposable repository and any worktrees and branches left in it. Disposable Sesh sessions are archived by Mark.

## Policies and decisions checked

- [policies/0001-optimistic-configuration-saves.md](../policies/0001-optimistic-configuration-saves.md) covers saving Pico's configuration. This proposal adds no configuration, so it doesn't apply.
- `decisions/` holds only its index.
- [VISION.md](../VISION.md): one visible delegation backend through Sesh child sessions, native delegation excluded. Honored; children are still Sesh children.
- **Conflict:** [PROTOTYPE.md](../PROTOTYPE.md#delegation-through-child-sessions) says Sesh owns workspaces and worktrees and to "use Sesh's default separate worktree/branch behavior". The guide says "Sesh still owns worktrees". This proposal moves worktree creation for Pico's children to Pico, through Worktrunk, and leaves Sesh owning the sessions, their reporting and their lifecycle. Mark chose this direction on 2026-11-09. PROTOTYPE.md, the guide and AGENTS.md are revised with the implementation.
- [Proposal 0003](0003-pico-only-child-sessions.md): the agent-override rejection runs first and is unchanged. Sesh still validates launches. Unlike 0003's forwarding, an accepted launch's `project`, `inPlace` and `baseBranch` are now rewritten, and the tool's description gains the worktree sentence.
- [Proposal 0001](0001-acp-adapter-core.md): no approval requests, visible tool calls, truthful failures. Kept. `--yes` stands in for an approval no one could give, and cleanup is shown as tool calls.
- [Proposal 0002](0002-pico-homebrew-distribution.md) defines the formula. This proposal adds one runtime dependency to it.
- [Proposal 0004](0004-session-restoration.md): worktree records live in the parent's private history and follow its restoration.

## Future directions

- The Mac app's readiness checks could report Worktrunk's presence and version alongside `pico`'s.
- A read-only research child (PROTOTYPE.md) could skip worktree creation once Sesh offers an enforceably read-only launch.

## Alternatives considered

- **Re-admit OMP's `task` subagents with Worktrunk isolation.** This reverses the VISION.md exclusion and an AGENTS.md hard rule. The OMP extension API can't set a subagent's folder either, which would leave only a guard on file-writing tools, and `bash` gets around that guard. Mark chose the Sesh hook.
- **Keep Sesh's worktrees and pass `baseBranch`.** This fixes the starting commit but runs no setup before the child starts and keeps the cleanup problem. Mark chose Worktrunk.
- **Save approvals with `wt config approvals add`.** This changes the user's own Worktrunk configuration and outlives Pico, and Pico doesn't rewrite user-owned configuration. `--yes` approves only the run Pico performs.
- **Commit or snapshot the parent's changes automatically.** Mark chose refusal: commits keep their authors' messages and hooks, and the parent's branch gets no commits nobody wrote.
- **Clean up only when the parent session closes.** This keeps follow-up messages to idle children working, but leaves worktrees around for the parent's whole life. Mark chose cleanup when the child's turn ends.
- **Rely on `wt remove`'s own merge check.** It compares with the default branch, so it would keep the branch of every clean child started from a feature branch.
- **Follow the user's Worktrunk `worktree-path`.** With the default template, every child worktree sits beside the repository in plain view. Mark wants them out of sight in `../.worktrees`. Project config can't set the location, so Pico sets it per run.
- **Place each worktree with `--path`.** Equivalent location, but the flag is experimental and Pico would have to sanitize branch names itself. `--config-set` keeps Worktrunk's own naming.
- **Fail launches into folders outside git.** Strictly closed, but it would end delegation in non-git folders, where no worktree is possible and Sesh already runs children in the folder. Mark chose to launch those unchanged and say so in the result.

## Open questions

None. Mark settled the open choices on 2026-11-09: hook Sesh's `start_session` rather than OMP subagents; refuse launches from a checkout with uncommitted changes; remove unchanged worktrees when the child's turn ends; make the formula depend on Worktrunk; put child worktrees in `../.worktrees/<repo>.<branch>`; launch non-git children unchanged, without a worktree.
