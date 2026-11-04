# Pico

Pico is the development starting point for two programs: an ACP adapter that exposes an [OMP](https://omp.sh) SDK agent to Sesh, and a native macOS app that configures and manages that adapter so its user never opens a terminal. The adapter's core turn path exists: Sesh can launch it as a custom agent, pick its model and thinking level, see every tool call, and cancel work ([`guides/running-pico-in-sesh.md`](guides/running-pico-in-sesh.md)). Pico keeps its own settings and Keychain credentials, read and changed through agent-first commands (`pico --help`). An agent can give you the SDK's provider authorization URL, then store and explicitly select the resulting credential. Pico does not reuse terminal OMP credentials. Credential changes apply to every session's next provider request; model and reasoning choices remain session-local. The Mac app's Models pane reads Pico's catalog and saves model/reasoning defaults through those commands; General shows the actual settings file location. Other configuration controls remain visibly unconnected, and sample mode has been removed ([`guides/refining-the-mac-app-ui.md`](guides/refining-the-mac-app-ui.md)).

## Install

On an Apple silicon Mac with macOS 14 or later:

```sh
brew install markmals/tap/pico
```

Then add `/opt/homebrew/bin/pico` to Sesh as a custom agent; [the guide](guides/running-pico-in-sesh.md) has the steps. `pico` is a single executable with nothing else to install, and it is ad-hoc signed, not notarized.

[`PROTOTYPE.md`](PROTOTYPE.md) is the brief for the sessions that build them: the planned behavior, the evidence each claim needs, and the acceptance criteria. Its [native macOS configuration app](PROTOTYPE.md#native-macos-configuration-app) section is the Mac app's half. It is an implementation brief, not an approved proposal. [`VISION.md`](VISION.md) states the purpose and the deliberate exclusions. [`AGENTS.md`](AGENTS.md) is the working contract for an agent in this repository.

## Stack

[Bun](https://bun.sh) is the JavaScript/TypeScript runtime, package manager, and test runner for the adapter, workflow scripts, and skill helpers. Oxfmt formats, Oxlint lints, and `tsc` type-checks in strict mode, each invoked through Bun by a mise task. The Mac app is Swift 6 and SwiftUI with its sources in `app/`, and Tuist generates `Pico.xcodeproj` from `Project.swift`; the generated project is not committed. Mise pins Bun, hk, Beads, Worktrunk, `gh`, and actionlint, plus Tuist on macOS. Node is not a repository prerequisite.

## Requirements

[mise](https://mise.jdx.dev) installs the pinned tools on macOS or Linux. Native tasks need a Mac with full Xcode selected, since `swift format`, `xcodebuild`, and `xcrun` come from it; building the Mac app needs an Xcode carrying the macOS 27 SDK, because macOS 27 is the app's deployment floor. Tuist installs on macOS only. `mise run check` includes the native check on macOS; Linux skips that step and retains the Bun workflow gate.

## Getting started

```sh
mise trust && mise install   # the pinned toolchain, including Bun and hk
mise run setup               # dependencies, work tracker, git hooks
mise run status              # where the work stands: phase, next action, who acts
```

`mise run check` should pass on a clean clone. If it does not, fix that before starting any feature work.

`mise run macos:check` checks Swift formatting, generates the Xcode project from `Project.swift`, builds the Debug app, runs the native tests, and reads the build settings that `xcodebuild` resolves. It is included in `mise run check` on macOS, skips off a Mac, and runs in its own macOS CI job on the `xcode-27` runner image.

### Dependency status

The project pins OMP SDK `18.14.0` and ACP SDK `2.1.0`, run under Bun `1.4.4`. The adapter has been exercised in real Sesh sessions with real provider credentials, and `mise run acp:smoke` and `mise run acp:tck` repeat that evidence on demand; `mise run pico:smoke` and `mise run pico:tck` do the same for the compiled `pico`.

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
| `mise run macos:check`    | macOS only: format, generation, build, native tests        |
| `mise run macos:build`    | build the Debug `Pico.app` into `.build/macos`             |
| `mise run macos:run`      | build the Mac app and open this checkout's copy            |
| `mise run macos:test`     | run the Mac app's native tests                             |
| `mise run acp:launcher`   | write `.build/pico-acp`, the adapter Sesh launches         |
| `mise run acp:smoke`      | drive the adapter through a real session, your credentials |
| `mise run acp:tck`        | check the adapter against the ACP compatibility kit        |
| `mise run pico:build`     | compile `.build/pico`, the executable Homebrew ships       |
| `mise run pico:verify`    | run `.build/pico` offline: version, initialize, a turn     |
| `bd ready`                | the work graph: what is ready, what is blocked             |
| `mise tasks`              | everything else, with descriptions                         |

`mise run check` is what the pre-push hook and CI both run. If it is green, the change is ready to push.

There is no `dev` or `start` task; the development launcher runs from source, and `pico:build` compiles the shipped executable. `mise run macos:build` and `mise run macos:run` build and launch the Mac app, and `mise run macos:test` runs its native tests. There is no release or deploy task: a release is a version tag plus a pull request to `markmals/homebrew-tap`, as [`AGENTS.md`](AGENTS.md) describes.

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
- `adapter/`, the ACP adapter with its curated turn path, Pico-only child launches, private session persistence, background jobs, Pico-owned settings and Keychain credentials with agent-first commands ([proposals 0001–0004 and 0006–0009](proposals/)), with tests beside the code; `native/keychain/`, the synchronous credential-storage bridge; `tools/write-launcher.ts`, which writes `.build/pico-acp`; and `tools/build-pico.ts`, which compiles the executable and generates its third-party notices.
- `LICENSE` (MIT).
- `tools/check-scoped-commit.ts` with its tests, enforcing commit subjects from `commit-msg`, and `tools/check-pr-commits.ts`, which applies the same rule to a pull request. They are the live example of the TypeScript and test conventions here.
- the Workbench workflow scripts `tools/status.ts`, `tools/validate.ts` and `tools/require-changeset.ts`, with their tests.
- `AGENTS.md`, `PROCESS.md`, `.agents/rules/`, `.agents/skills/` and `.agents/templates/`: the process, the binding rules, and the record templates.
- `.omp/extensions/`, the harness lifecycle wiring: the gate on session stop, formatting after an edit, and `bd prime` once per session.
- `hk.pkl`, `.oxfmtrc.jsonc`, `.oxlintrc.jsonc`, `tsconfig.json`, `.changeset/`, and the mise and Bun lockfiles.
- `app/`, the Mac app's Swift: the window scene, sidebar navigation, six settings panes, the command-backed Models and Settings file connection, and the string catalog.
- `Project.swift`, `Tuist.swift`, `Config/Version.xcconfig` and `.swift-format`: the Mac app's project configuration. One macOS target named `Pico`, bundle identifier `me.malstrom.pico`, deployment target macOS 27, Swift 6 with complete strict concurrency, and unsigned.
- `.github/workflows/ci.yml`, which runs `mise run check`, runs `mise run macos:check` and `mise run pico:verify` on the `xcode-27` macOS runner image, checks every commit subject in a pull request, and rejects a pull request without a changeset.
- `Formula/pico.rb` in [`markmals/homebrew-tap`](https://github.com/markmals/homebrew-tap), which builds `pico` from a release tag and whose bottles the tap's CI builds.

Not implemented. Nothing below is faked; where the Mac app shows a control for something it cannot do, that control is visibly unconnected:

- broader child-session handoff and integration workflows; Autonomous sessions; MCP servers beyond the ones Sesh sends. These remain follow-up work tracked in Beads.
- approval prompts, by design: Pico auto-approves every tool call.
- the Mac app's provider sign-in and credential management, runtime readiness or version inspection, Sesh registration, and bundled engine or runtime. Models and the Settings file row use real configuration; the remaining controls are unconnected stubs. Providers & Accounts remains Beads `pico-bfk.7`.

`proposals/` holds proposals 0001–0007, and `guides/` holds their guides; `decisions/` and `policies/` hold only their index READMEs. Empty record directories are the healthy state, not a gap to fill.

[`CHANGELOG.md`](CHANGELOG.md) records the initial template adaptation.
