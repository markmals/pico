# Pico

Pico is the development starting point for two programs: an ACP adapter that will expose an [OMP](https://omp.sh) SDK agent to Sesh, and a native macOS app that configures and manages that adapter so its user never opens a terminal. Neither exists yet. Nothing in this repository speaks ACP, loads the OMP SDK, runs an agent, or draws a window.

[`PROTOTYPE.md`](PROTOTYPE.md) is the brief for the sessions that build them: the planned behavior, the evidence each claim needs, and the acceptance criteria. Its [native macOS configuration app](PROTOTYPE.md#native-macos-configuration-app) section is the Mac app's half. It is an implementation brief, not an approved proposal. [`VISION.md`](VISION.md) states the purpose and the deliberate exclusions. [`AGENTS.md`](AGENTS.md) is the working contract for an agent in this repository.

## Stack

[Bun](https://bun.sh) is the JavaScript/TypeScript runtime, package manager, and test runner for the adapter, workflow scripts, and skill helpers. Oxfmt formats, Oxlint lints, and `tsc` type-checks in strict mode, each invoked through Bun by a mise task. The Mac app is Swift 6 and SwiftUI, with Tuist generating `Pico.xcodeproj` from `Project.swift`; the generated project is not committed. Mise pins Bun, hk, Beads, Worktrunk, `gh`, and actionlint, plus Tuist on macOS. Node is not a repository prerequisite.

## Requirements

[mise](https://mise.jdx.dev) installs the pinned tools on macOS or Linux. Native tasks need a Mac with full Xcode selected, since `swift format`, `xcodebuild`, and `xcrun` come from it. Tuist installs on macOS only. `mise run check` includes the native configuration check on macOS; Linux skips that step and retains the Bun workflow gate.

## Getting started

```sh
mise trust && mise install   # the pinned toolchain, including Bun and hk
mise run setup               # dependencies, work tracker, git hooks
mise run status              # where the work stands: phase, next action, who acts
```

`mise run check` should pass on a clean clone. If it does not, fix that before starting any feature work.

`mise run macos:check` checks Swift formatting, generates the Xcode project from `Project.swift`, and reads the build settings that `xcodebuild` resolves. It is included in `mise run check` on macOS, skips off a Mac, and runs in its own macOS CI job.

### Dependency status

The project pins OMP SDK `18.14.0` and ACP SDK `2.1.0`. Both package imports were exercised under Bun `1.4.4` with external Node disabled; no provider prompt or adapter behavior was exercised.

Bun leaves lifecycle scripts for the transitive `onnxruntime-node` and `protobufjs` dependencies blocked. The imports work with those scripts blocked. Review any requirement for them when exercising the engine; optional native/runtime features have not been verified, and setup does not grant blanket script trust.

Bun supplies the `node:*` compatibility modules used by existing scripts and tests, including `node:test`; these imports do not launch or require Node. Package executables are explicitly forced through Bun so their `node` shebangs do not become a hidden system dependency.

## Everyday commands

| Command                   | Does                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `mise run check`          | the blocking gate: formatting, lint, types, records, tests |
| `mise run test`           | run the test suites once                                   |
| `mise run fmt`            | format with Oxfmt in place                                 |
| `mise run validate`       | check record frontmatter, IDs, and cross-references        |
| `mise run status`         | where the work stands: phase, next action, who acts        |
| `mise run changeset`      | add the changeset every pull request carries               |
| `mise run macos:generate` | generate the Mac app's Xcode project from `Project.swift`  |
| `mise run macos:check`    | macOS only: Swift format, generation, resolved settings    |
| `bd ready`                | the work graph: what is ready, what is blocked             |
| `mise tasks`              | everything else, with descriptions                         |

`mise run check` is what the pre-push hook and CI both run. If it is green, the change is ready to push.

There is no `dev`, `build`, `start`, or `acp` task because there is no executable yet, and no task that builds or launches the Mac app because that target has no sources. The session that writes either one adds the task with it. There is no release or deploy task at all.

## How this project is built

Development follows the Workbench process: understand the problem, record intent in a proposal, then derive tests, guides and code from it. [`AGENTS.md`](AGENTS.md) is the operative contract for agents and the shortest description of how work moves; [`PROCESS.md`](PROCESS.md) is the full version.

| Where                          | What                                                     |
| ------------------------------ | -------------------------------------------------------- |
| [`VISION.md`](VISION.md)       | the project's purpose, MVP target, and principles        |
| [`PROTOTYPE.md`](PROTOTYPE.md) | the implementation brief for the adapter and the Mac app |
| [`proposals/`](proposals/)     | the specification for each change, preserved as history  |
| [`decisions/`](decisions/)     | architectural choices and the context that produced them |
| [`policies/`](policies/)       | rules future work must keep enforcing                    |
| [`guides/`](guides/)           | human-facing prose on how features behave                |
| `bd ready`                     | the work graph: what is ready, what is blocked           |

Beads (`bd`) is the work tracker, the ready-work queue, and durable agent memory; `bd prime` loads it at the start of a session. Every pull request carries a changeset, and [`CHANGELOG.md`](CHANGELOG.md) is written from them by `mise run version`.

## Current status

In the repository today:

- `mise.toml`, the only task graph. Every routine command is a mise task.
- `tools/check-scoped-commit.ts` with its tests, enforcing commit subjects from `commit-msg`, and `tools/check-pr-commits.ts`, which applies the same rule to a pull request. They are the live example of the TypeScript and test conventions here.
- the Workbench workflow scripts `tools/status.ts`, `tools/validate.ts` and `tools/require-changeset.ts`, with their tests.
- `AGENTS.md`, `PROCESS.md`, `.agents/rules/`, `.agents/skills/` and `.agents/templates/`: the process, the binding rules, and the record templates.
- `.omp/extensions/`, the harness lifecycle wiring: the gate on session stop, formatting after an edit, and `bd prime` once per session.
- `hk.pkl`, `.oxfmtrc.jsonc`, `.oxlintrc.jsonc`, `tsconfig.json`, `.changeset/`, and the mise and Bun lockfiles.
- `Project.swift`, `Tuist.swift`, `Config/Version.xcconfig` and `.swift-format`: the Mac app's project configuration. One macOS target named `Pico`, bundle identifier `me.malstrom.pico`, deployment target macOS 14, Swift 6 with complete strict concurrency, unsigned, and no sources.
- `.github/workflows/ci.yml`, which runs `mise run check`, runs `mise run macos:check` on a macOS runner, checks every commit subject in a pull request, and rejects a pull request without a changeset.

Not in the repository, and not stubbed anywhere:

- an ACP server, session handling, or any wiring to the OMP SDK.
- Sesh MCP tool exposure, delegation to Sesh child sessions, or permission handling.
- any claim that a prototype capability works. Working means exercised in Sesh, as [`PROTOTYPE.md`](PROTOTYPE.md) defines it.
- the Mac app: no SwiftUI views, no provider sign-in, no model catalog, no bundled engine or runtime, and no task that builds or launches an app. The target has no sources, and a target with no sources is configuration, not an application.

`proposals/`, `decisions/`, `policies/` and `guides/` hold only their index READMEs. Empty record directories are the healthy starting state, not a gap to fill.

[`CHANGELOG.md`](CHANGELOG.md) records the initial template adaptation.
