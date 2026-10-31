---
id: proposal.0002
title: Picod Homebrew Distribution
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/3
issues: []
supersedes: []
---

# Picod Homebrew Distribution

## Summary

Ship Pico's ACP agent as `picod`, a signed and notarized Bun single-file executable that keeps its own files in `~/Library/Application Support/Pico`. Install it with `brew install markmals/tap/pico`, a cask that can later also carry the settings app and a `pico` CLI.

## Motivation

Pico runs today only from a checkout. `mise run acp:launcher` writes `.build/pico-acp`, a two-line launcher that runs `adapter/main.ts` with mise's pinned Bun out of the repository's `node_modules`. Using Pico in Sesh therefore takes:

- a clone;
- mise;
- `mise install` and `mise run setup`;
- a rebuilt launcher after every move;
- a Sesh agent entry pointing into the checkout.

Nobody but the developer can install it, and an update means pulling and rebuilding. Mark wants Pico installable and upgradable with one Homebrew command, and wants that command to grow into installing the macOS settings app and an agent-first `pico` CLI as well.

The checkout path also writes into OMP's directories. The native addon OMP extracts and the model cache both land in `~/.omp`. Mark wants Pico's own files to live in a Pico-owned directory from the first packaged release.

## Domain grounding

### Established context

**Bun single-file executables**

- `bun build --compile` embeds the module graph, and `require()` of a `.node` file embeds that addon. Files imported `with { type: "file" }` are embedded and exposed at `/$bunfs/root/…` paths, which are virtual, not on disk ([Bun: single-file executables](https://bun.sh/docs/compiler/executables.md)).
- At load time Bun extracts an embedded `.node` to `$TMPDIR/.bun-<uid>-<hash>.node` (`/private/tmp` when `TMPDIR` is unset) and reuses an existing file of the same size. This was observed locally with Bun 1.4.4: a same-size file with one byte flipped was loaded without re-extraction.
- Bun ad-hoc signs compiled Mach-O binaries unless `BUN_NO_CODESIGN_MACHO_BINARY=1` is set. Bun documents signing a compiled executable with `allow-jit` and `allow-unsigned-executable-memory` entitlements. A local experiment showed Developer ID signing after compilation leaves the embedded module graph working.

**OMP's native addon and directories**

- The addon's loader (`@oh-my-pi/pi-natives/native/loader-state.js`, lines 166–191) tries, in order:
    - `getNativesDir()/<version>/`;
    - `~/.local/bin/`;
    - the bundled `native/` directory;
    - the executable's directory.
- `getNativesDir()` honours `PI_NATIVES_DIR` (absolute paths only) before falling back to `~/.omp/natives`. It never derives from OMP's `agentDir` (lines 62–76).
- A compiled build extracts an embedded addon into that versioned directory, but only when the build replaced `native/embedded-addon.js`, which is `null` on disk (`maybeExtractEmbeddedAddon`, lines 509–531). OMP's release build does the replacement with `natives/scripts/embed-native.ts`, which the published packages do not ship.
- The shipped addon `pi_natives.darwin-arm64.node` is ad-hoc signed with no Team ID.
- OMP's `agentDir` option governs both reads and writes. It sets where OMP:
    - reads your settings, `models.yml`, extensions, skills, rules, AGENTS.md and credentials;
    - writes `agent.db`, `models.db`, `skill-descriptions.db` and `cache/`.

    Moving it would cut Pico off from the user's OMP configuration.

- `createAgentSession` accepts a `modelRegistry`, and `ModelRegistry`'s constructor accepts `cacheDbPath` (`dist/types/sdk.d.ts:54`, `config/model-registry.d.ts:67`), so the model cache can move on its own. No public option relocates `skill-descriptions.db`. OMP's logs (`~/.omp/logs`) have no relocation option on macOS.

**Building OMP into one binary**

- OMP imports a virtual module, `omp-legacy-pi-modules`. Its build plugin generates a lazy `import()` map over every exported subpath of OMP's packages, so that extensions loaded at runtime by a compiled binary can import OMP's packages (`src/extensibility/plugins/legacy-pi-compat.ts:21-37`).
- The shipped plugin only works inside OMP's monorepo. A spike that replaced the module with an empty map compiled Pico into a 175 MB binary that passed Pico's real-model smoke test (18/18). It failed to load the addon in a clean environment.
- OMP's compiled build also inlines a docs index (`PI_DOCS_EMBED`) for `omp://` reads. Its generator reads a `docs/` directory that the published package does not ship.

**Signing and notarization**

- Under the hardened runtime, library validation refuses to load a library unless Apple or the main executable's Team ID signed it ([Apple: disable-library-validation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)). Libraries inherit their host's entitlements ([Apple: Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)).
- Bun extracts an embedded addon byte for byte, so a Developer ID signature applied to the addon before embedding survives into the loaded file (observed locally).
- Notarization requires:
    - a Developer ID certificate;
    - the hardened runtime on every executable;
    - a secure timestamp;
    - no `get-task-allow`.

    A bare executable is notarized inside a ZIP, and its ticket cannot be stapled to the binary or the ZIP ([Apple: Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution); [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).

- The machine has the identity "Developer ID Application: Mark Malstrom (647GR2UNM5)".

**Homebrew casks**

- A cask may ship only a `binary` stanza, for example `1password-cli`. An `app` stanza can be added to the same cask later without a migration ([Cask Cookbook](https://docs.brew.sh/Cask-Cookbook#at-least-one-artifact-stanza-is-also-required)).
- `brew install markmals/tap/pico` tries a formula first, then a cask of that name. Naming the tap explicitly also grants trust to that one cask ([Tap Trust](https://docs.brew.sh/Tap-Trust#installing-from-a-tap)).
- Homebrew quarantines every file a cask installs ([Security and supply chain](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain#casks-have-a-different-trust-model)). `--no-quarantine` was removed in Homebrew 6.0.14.
- `brew audit --new --cask` checks notarization (`cask/audit.rb:1314`). Homebrew 5.0 deprecated casks that fail Gatekeeper.
- Casks have no bottles: a cask downloads a prebuilt artifact by `url` and `sha256`.
- `brew upgrade` installs the new version into `Caskroom/<token>/<version>/` and then deletes the old version's directory. A process running from the old directory kept running to completion (observed locally).
- `brew services` works for formulae only; a cask has no launchd service support.
- `*flight` Ruby blocks are deprecated for third-party taps.

**Gatekeeper**

- A Developer ID-signed, unnotarized, quarantined CLI was rejected by `spctl`, yet ran when started from a shell, `env -i`, `osascript` or `launchctl submit` (observed locally). Gatekeeper's check fires when the Finder opens a file, not on every `execve`.

**The existing tap**

- `markmals/homebrew-tap` is public. It holds formulae only (`recon`, `remctl`, `vid`, `vite-plus`, `apple-platform-tools`); none has a `service` block.
- `recon` builds from a public source tag and hosts bottles on the tap's releases.
- `vite-plus` is updated by a scheduled tap workflow that polls upstream, recomputes `sha256` and commits the new version.
- No formula or cask named `pico` exists in Homebrew's core or cask repositories (`brew info pico`).

**Sesh**

- Sesh launches a custom agent by absolute executable path and speaks ACP over its stdin and stdout. `~/Library/Application Support/Sesh/agents.json` entries carry `executable`, `id` and `name` (observed).
- `AGENTS.md` forbids inventing a Sesh registration API.

### Relevant constraints and principles

- **Homebrew is the install path.** Mark decided that Homebrew is Pico's product install path, full stop, and that installed pieces may rely on Homebrew-provided locations. This revises the `VISION.md` goal of installing without a package manager, and the brief's rule against depending on Homebrew (`PROTOTYPE.md`, "End-user setup" and "Native macOS configuration app").
- **Nothing more leaves `~/.omp` yet.** Pico keeps reading the user's OMP configuration and credentials, and OAuth refresh keeps writing `agent.db`, as proposal 0001 approved. Only what public APIs can relocate without changing reads moves to Pico's directory.
- **No daemon yet.** `picod` is the stdio agent Sesh launches; nothing runs under launchd.
- **Public first, with notarization.** The repository goes public under the MIT license before any artifact is published. Every release is notarized.
- **Release builds run in GitHub Actions** once the repository is public, because public macOS runners are free. Actions stay disabled until then (Beads memory).
- **Publishing needs Mark's explicit confirmation** each time (`AGENTS.md` hard rules).
- **`picod` is the product, `mise` is not.** `picod` must behave exactly like the source build that proposal 0001 verified. Nothing at runtime may depend on mise, a Bun installation, a login shell or `PATH`.

### Quality bar

- **A real install:** `brew install markmals/tap/pico` on a Mac without the checkout installs `picod`, and a Sesh session using it passes the 0001 behaviors.
- **The same tests:** the compiled binary passes the same smoke run and ACP compatibility kit as the source build.
- **Real signing:** the release artifact passes `codesign --verify --strict`, notarization, `spctl` assessment of the notarized build, and `brew audit --cask` for the tap cask.
- **Signing checked where it is enforced:** this Mac has SIP disabled and boot-args that bypass AMFI, so library validation is not enforced here. Signing behavior must be confirmed on a Mac or VM with SIP enabled.

### Remaining uncertainty

- **Does JavaScriptCore need `allow-jit` and `allow-unsigned-executable-memory`** under enforcing AMFI? Bun recommends both, and this proposal keeps both.
- **How notarization handles a roughly 200 MB single-file binary** is untested.
- **Can the model reach `omp://` docs through Pico's `read` tool** in the source build? If it can, `picod` must match; see Detailed design.
- **Do Pico sessions write OMP's `stats.db` or `autoqa.db`?** OMP's own harness on this Mac writes both, so whether Pico does is unattributed. Implementation must measure what a `picod` session writes under `~/.omp`.

## Existing baseline

- **`.build/pico-acp`** proves the adapter needs nothing beyond Bun and `node_modules`. It stays as the development launcher; `picod` does not replace it for development.
- **OMP's `scripts/compile-binary.ts`** is the closest prior art for building `picod`:
    - external `fastembed` and `onnxruntime-node`;
    - `PI_COMPILED=true`;
    - bytecode and splitting;
    - the legacy module plugin;
    - an embedded native addon;
    - its own codesign step.

    Its embed and docs steps depend on unshipped monorepo files, so Pico reimplements those two against the installed packages. OMP signs ad hoc and does not notarize; Pico must go further.

- **`recon`** shows Mark's tap conventions: a pinned arm64 macOS floor, a stable signing identifier and caveats about re-granted permissions.
- **`vite-plus`'s scheduled updater** is the convention for tracking upstream releases from the tap, and this proposal reuses it for the cask.
- **`1password-cli`** is a working example of a binary-only cask.

## Proposed solution

Build `picod` from `adapter/main.ts` with a Pico-owned Bun build script. The script generates OMP's legacy module map from the installed packages and embeds the native addon, re-signed with Mark's Developer ID. Developer ID signing, notarization and zipping happen in a GitHub Actions release workflow that needs Mark's approval before it publishes.

The tap gains a `pico` cask. It installs `picod` onto `PATH` and follows new releases with a scheduled updater, as `vite-plus` does. `picod` keeps the files it creates in `~/Library/Application Support/Pico`: the extracted addon and the model cache.

```text
brew install markmals/tap/pico      → /opt/homebrew/bin/picod (notarized)
Sesh custom agent → /opt/homebrew/bin/picod → ACP session, as in proposal 0001
brew upgrade                        → running sessions continue; new sessions get the new build
```

## Detailed design

### The `picod` executable

- `mise run picod:build` compiles `adapter/main.ts` into `.build/picod`, a single arm64 macOS executable, using `tools/build-picod.ts`, a zero-dependency Bun script. The build:
    - marks `fastembed` and `onnxruntime-node` external;
    - defines `process.env.PI_COMPILED` as `"true"`;
    - disables bunfig, dotenv, tsconfig and package.json autoloading in the binary;
    - sets `BUN_NO_CODESIGN_MACHO_BINARY=1`, then signs ad hoc itself for local use.
- The build resolves `omp-legacy-pi-modules` to a lazy `import()` map covering every exported subpath of the installed `@oh-my-pi/pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-coding-agent`, `pi-natives`, `pi-tui`, `pi-utils` and `typebox`, matching the map OMP's plugin generates. A user or project extension that imports one of those packages loads in `picod` as it does in the source build.
- The build replaces `@oh-my-pi/pi-natives/native/embedded-addon.js` with a module describing the embedded `pi_natives.darwin-arm64.node`, in the shape `loader-state.js` expects. The embedded file is the addon as signed by the release step (see Signing and notarization), or as shipped, for local builds.
- Run with no arguments, `picod` is the proposal 0001 agent: ACP over stdin and stdout, with identical behavior.
- `picod --version` prints `picod <version>`, a newline, and exits 0. The version is the `package.json` version, which is also the `agentInfo.version` Pico reports in `initialize`.
- Any other argument makes `picod` print `usage: picod [--version]` to stderr and exit 2 without starting ACP.
- `picod` reads nothing from the repository, mise or a Bun installation. A `picod` started with only `HOME`, `USER` and `PATH=/usr/bin:/bin` behaves as when Sesh starts it.
- If the source build lets the model read `omp://` documentation through the `read` tool, `picod` embeds the same documentation, so the read returns the same content. If the source build cannot read it, `picod` does not either. Implementation records which case holds.

### Pico's data directory

- Pico's data directory is `~/Library/Application Support/Pico`. Pico creates it with mode `0700` when missing. Both `picod` and the development launcher use it for the files below.
- **Native addon.**
    - Before OMP's native loader runs, `picod` sets `PI_NATIVES_DIR` to `<data dir>/natives`. The addon then extracts to `<data dir>/natives/<pi-natives version>/pi_natives.darwin-arm64.node`.
    - Before loading an existing extracted file, `picod` compares its SHA-256 with the embedded bytes. A missing or mismatched file is rewritten through a temporary file and an atomic rename.
    - Extraction never uses `$TMPDIR`.
    - On start, `picod` removes sibling version directories under `<data dir>/natives`. A process still running an older version keeps its loaded copy, because a mapped file outlives deletion.
    - The development launcher keeps loading the addon from `node_modules` and does not extract it.
- **Model cache.** Pico creates its session's `ModelRegistry` itself:
    - the user's credential store;
    - `<agentDir>/models.yml` read from the user's OMP agent directory;
    - the user's settings;
    - `cacheDbPath` set to `<data dir>/models.db`.

    Pico passes that registry to `createAgentSession`. Model resolution, availability and the 0001 model menus behave exactly as before.

- **Failures.** If the data directory or a file in it cannot be created or written, `picod` writes `pico: cannot use <path>: <cause>` to stderr and exits 1 before answering any ACP message. Sesh shows the agent's failure to start.
- **What stays in `~/.omp`:**
    - Reads of OMP settings, `models.yml`, extensions, skills, rules, AGENTS.md and credentials.
    - OAuth refresh writes to `agent.db`.
    - `skill-descriptions.db`, which no public option relocates.
    - OMP's logs in `~/.omp/logs`, which nothing relocates on macOS.

    Implementation lists every path a `picod` session writes under `~/.omp`, measured with a scratch `HOME`, in the guide's limits.

### Signing and notarization

- A release build re-signs `pi_natives.darwin-arm64.node` with "Developer ID Application: Mark Malstrom (647GR2UNM5)", the hardened runtime and a secure timestamp. It does this before compiling, so the embedded and extracted addon carries the same Team ID as `picod`.
- The release build then signs `picod` with the same identity, the hardened runtime and a secure timestamp. The entitlements are exactly `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`. There is no `disable-library-validation` and no `get-task-allow`.
- The release build zips `picod`, `LICENSE` and `THIRD-PARTY-NOTICES.md` as `picod-<version>-darwin-arm64.zip`. It submits the zip with `xcrun notarytool submit --wait` using an App Store Connect API key, and fails unless the status is `Accepted`. It then verifies:
    - `codesign --verify --strict --verbose=2` on `picod`;
    - `spctl --assess --type exec` on `picod` extracted from the notarized zip.

### Release workflow

- **The workflow.** `.github/workflows/release.yml` runs on `macos-latest` arm64 runners with mise. It builds from a commit, runs `mise run check`, builds `picod`, and runs the smoke test and the ACP compatibility kit against the compiled binary. It then signs and notarizes as above and produces the zip and its SHA-256.
- **Its two triggers:**
    - `workflow_dispatch` on any branch builds the notarized zip and uploads it as a workflow artifact, without publishing anything. This is how previews are built.
    - A pushed tag `v<version>` whose version equals `package.json`'s builds the same zip. A job bound to a GitHub environment named `release`, with Mark as required reviewer, then creates the GitHub release `v<version>` with the zip and its `.sha256` file attached. Mark's approval in that environment is the confirmation that publishing requires.
- **Signing secrets.** The repository's `release` environment holds:
    - the Developer ID certificate as a password-protected `.p12`, imported into a temporary keychain that is deleted at the end of the job;
    - the App Store Connect API key, its key ID and its issuer ID.

    No secret is printed. Jobs from fork pull requests get no secrets, and no workflow signs fork code.

- **Versions.** They come from Changesets: `mise run version` bumps `package.json`, `CHANGELOG.md` and `Config/Version.xcconfig`, and lands through a pull request. A tag is pushed only from `main` after that pull request merges. The first release is `v0.1.0`.
- **Third-party notices.** `tools/write-notices.ts` regenerates `THIRD-PARTY-NOTICES.md` from the build's metafile. The file lists every package bundled into `picod`, with its name, version, license identifier and license text. It also includes the Bun runtime's license. The release workflow fails when the committed file differs from what its build produces, so a dependency change cannot ship stale notices.
- **`picod:smoke` and `picod:tck`.** `mise run picod:smoke` and `mise run picod:tck` run the existing smoke test and compatibility kit against `.build/picod` instead of `.build/pico-acp`.

### The `pico` cask

- `markmals/homebrew-tap` gains `Casks/pico.rb`:
    - `version` and `sha256` of the latest release;
    - `url "https://github.com/markmals/pico/releases/download/v#{version}/picod-#{version}-darwin-arm64.zip"`;
    - `name "Pico"`, a one-line `desc`, and `homepage "https://github.com/markmals/pico"`;
    - `depends_on arch: :arm64` and `depends_on macos: :sonoma` (macOS 14 or later);
    - `binary "picod"`;
    - `zap trash: "~/Library/Application Support/Pico"`;
    - `livecheck` on GitHub releases;
    - caveats giving the Sesh registration steps (see Sesh registration).

    The cask has no `*flight` blocks and no `uninstall` stanza beyond what `binary` implies.

- `brew install markmals/tap/pico` installs the cask and links `/opt/homebrew/bin/picod`. `brew uninstall pico` removes the binary and keeps the data directory. `brew uninstall --zap pico` also trashes the data directory.
- `brew audit --new --cask markmals/tap/pico` and `brew style --cask` pass for the cask.
- **The updater.** `.github/workflows/update-pico.yml` in the tap runs daily and on `workflow_dispatch`, like `update-vite-plus.yml`. It compares the latest non-prerelease `markmals/pico` release with the cask's `version`. When they differ, it:
    - downloads the release zip;
    - verifies it against the release's `.sha256` file;
    - rewrites `version` and `sha256`;
    - commits `pico: update to <version>` to the tap's `main`.

    A release asset that fails verification fails the workflow without committing.

- **Upgrades.** `brew upgrade` installs the new version and deletes the old version's directory. Sessions already running keep the old `picod`. New Sesh sessions start the new binary through the unchanged `/opt/homebrew/bin/picod` path.

### Sesh registration

- Neither the cask nor `picod` registers Pico with Sesh or edits Sesh's files.
- The cask's caveats and the guide give Sesh's supported path: Settings › Machines › this Mac › Details… › Add an Agent… › Custom…, name "Pico", executable `/opt/homebrew/bin/picod`. That path survives upgrades.

### Making the repository public

- Before the first preview build:
    1. `LICENSE` (MIT, copyright Mark Malstrom) and the generated `THIRD-PARTY-NOTICES.md` are committed.
    2. Mark confirms making `markmals/pico` public. The visibility change happens only after that confirmation.
    3. GitHub Actions is re-enabled.
    4. Mark adds the `release` environment, its required reviewer and its secrets.

### Documents

- `guides/running-pico-in-sesh.md` gains:
    - installation with `brew install markmals/tap/pico`;
    - registration with `/opt/homebrew/bin/picod`;
    - upgrades and uninstall, including `--zap`;
    - the data directory;
    - the `~/.omp` writes that remain.

    The checkout and `mise run acp:launcher` remain the development path.

- `AGENTS.md` and `README.md` describe:
    - `picod`, its tasks and the release workflow;
    - the tap cask;
    - the signing and notarization path, replacing "Nothing is signed… there is no distribution or notarization path here" and "There is no release or deploy task at all".
- `PROTOTYPE.md`'s "End-user setup" row and its app section say that Homebrew is the install path and that installed pieces may rely on Homebrew-provided locations.
- In Phase 5, `VISION.md`'s goal changes from installing "without a terminal, a package manager, or a hand-edited configuration file" to installing and updating through Homebrew, with configuration in the native app.

## Compatibility

- **Development is unchanged:** the source launcher and `mise` tasks keep working. Existing `pico-dev` registrations pointing at `.build/pico-acp` keep working.
- **The model cache starts empty:** Pico's sessions stop updating `~/.omp/agent/models.db` and use `~/Library/Application Support/Pico/models.db`. The first session after upgrading refills it. Terminal OMP is unaffected.
- **Extracted addons move:** extraction goes to Pico's data directory. Earlier source builds never extracted one, so there is nothing to migrate.

## Implications on adoption

- Users need Homebrew 6 or later on an Apple silicon Mac running macOS 14 or later, and they trust the tap by naming it.
- Releases need, from Mark: the repository made public, Actions enabled, a `release` environment, the Developer ID certificate exported as `.p12`, and an App Store Connect API key for notarization.
- Adoption reverses with `brew uninstall --zap pico` and removing the Sesh agent entry. Making the repository public cannot be fully reversed: published code and releases may have been copied.

## Scope

- `tools/build-picod.ts`, including the legacy module map and the embedded addon module, with tests.
- `picod` argument handling: `--version` and usage errors.
- The data directory, addon extraction with verification and cleanup, and the relocated model cache, with tests.
- The `picod:build`, `picod:smoke` and `picod:tck` tasks.
- `tools/write-notices.ts`, `THIRD-PARTY-NOTICES.md` regeneration and its check, plus `LICENSE`.
- `.github/workflows/release.yml`, including the `release` environment gate.
- In the tap: `Casks/pico.rb` and `.github/workflows/update-pico.yml`.
- Documents: the guide, `AGENTS.md`, `README.md` and `PROTOTYPE.md`.
- Verification:
    - `picod` smoke and compatibility kit, in clean environments;
    - an extension that imports `@oh-my-pi/pi-coding-agent`, loaded by `picod`;
    - a measured list of `~/.omp` writes;
    - the notarized preview installed through the cask and exercised in Sesh;
    - signing confirmed on a Mac or VM with SIP enabled.

### Out of scope

- A launchd daemon, `brew services`, or a socket relay. Nothing needs persistent state yet.
- The `pico` CLI and the macOS settings app. The cask is shaped to take them later.
- Intel Macs and Linux. OMP's installed natives package and the tap's conventions are arm64 macOS.
- Moving credentials, OMP configuration, `skill-descriptions.db` or logs out of `~/.omp`. That needs a Pico-owned credential store (`pico-awc`) or OMP API changes.
- Registering Pico with Sesh automatically, which needs a supported Sesh path.
- Publishing the first release. It follows this proposal's acceptance, with Mark's approval in the `release` environment.

## Preview

- **Artifact:** the notarized `picod-<version>-darwin-arm64.zip`, built by `release.yml` through `workflow_dispatch` from this pull request's revision, plus a tap branch `pico-preview` whose `Casks/pico.rb` points `url` at a `file://` path to that zip.
- **Access:**
    1. Mark downloads the workflow artifact with `gh run download`.
    2. They check out `pico-preview` in `$(brew --repo markmals/tap)`.
    3. They run `brew install --cask markmals/tap/pico`, register `/opt/homebrew/bin/picod` in Sesh as "Pico", and exercise the 0001 behaviors and the model menus.
    4. `picod --version` prints the version, and `~/Library/Application Support/Pico` holds the extracted addon and `models.db`.
- **Reason:** installing through the real cask, from the real notarized artifact, is the change itself. A `file://` URL keeps anything from being published before acceptance.
- **Cleanup:** `brew uninstall --zap pico`, delete the downloaded zip, delete the `pico-preview` tap branch, and remove the Sesh agent entry.

## Policies and decisions checked

- `policies/` and `decisions/` contain only their index READMEs, so no recorded policy or decision applies.
- `VISION.md` conflicts with this proposal: its goal says Pico installs "without a terminal, a package manager, or a hand-edited configuration file". Mark resolved this by making Homebrew the install path, and the goal changes in Phase 5. The release workflow builds and publishes downloadable artifacts. It is not the hosted service or deployment pipeline that the vision's non-goals exclude.
- `PROTOTYPE.md`'s rule against depending on Homebrew is revised as described under Documents.

## Future directions

- An `app` stanza for the settings app and a `binary` for the `pico` CLI in the same cask, so one install command delivers all three.
- A daemon behind a stdio relay, for session restore or the settings app's helper channel. A cask would ship its own LaunchAgent, since casks cannot use `brew services`.
- A Pico-owned credential store and configuration (`pico-awc`), which would let Autonomous sessions work and remove Pico's remaining writes to `~/.omp`.
- Intel builds, if OMP's x64 natives and a need appear.

## Alternatives considered

- **A formula with bottles, like `recon`.** Homebrew would build Pico from source, the tap's CI would bottle it, and `brew services` would be available. It lost because the GUI app will need a cask, and a later formula-to-cask migration is avoidable churn.
- **A launchd daemon now.** Sesh speaks ACP only to a process it launches over stdio, so a daemon needs a relay and a socket protocol that nothing currently needs.
- **Shipping the addon beside the binary.** `picod` would load `pi_natives…node` from its own directory, with no extraction. Mark chose a single file with Pico-owned extraction.
- **Letting Bun extract the addon.** Bun writes to `$TMPDIR`, which is world-writable `/private/tmp` when unset, and reuses a tampered file of the same size.
- **Moving OMP's whole `agentDir` to Pico's directory.** That moves every read away from the user's configuration and credentials.
- **Signing and notarizing locally with a mise task.** It keeps secrets on the Mac, but Mark chose reproducible tag-driven builds in Actions.
- **Signing without notarizing.** `picod` would still run when Sesh launches it, but it would fail `brew audit --new --cask` and fall under Homebrew's deprecation of casks that fail Gatekeeper.
- **A public prerelease for the preview.** It exercises the public download path, but publishes before acceptance.

## Open questions

- None.
