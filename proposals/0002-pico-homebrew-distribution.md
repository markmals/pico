---
id: proposal.0002
title: Pico Homebrew Distribution
authors: [Mark Malstrom]
status: implemented
pull-request: https://github.com/markmals/pico/pull/3
issues: []
supersedes: []
---

# Pico Homebrew Distribution

## Summary

Ship Pico's ACP agent as `pico`, a Bun single-file executable that keeps its own files in `~/Library/Application Support/Pico`. Install it with `brew install markmals/tap/pico`, a formula with bottles in Mark's public tap.

## Motivation

Pico runs today only from a checkout. `mise run acp:launcher` writes `.build/pico-acp`, a two-line launcher that runs `adapter/main.ts` with mise's pinned Bun out of the repository's `node_modules`. Using Pico in Sesh therefore takes:

- a clone;
- mise;
- `mise install` and `mise run setup`;
- a rebuilt launcher after every move;
- a Sesh agent entry pointing into the checkout.

Nobody but the developer can install it, and an update means pulling and rebuilding. Mark wants Pico installable and upgradable with one Homebrew command, and wants that command to grow into installing the macOS settings app as well.

The checkout path also writes into OMP's directories. The native addon OMP extracts and the model cache both land in `~/.omp`. Mark wants Pico's own files to live in a Pico-owned directory from the first packaged release.

## Domain grounding

### Established context

**Bun single-file executables**

- `bun build --compile` embeds the module graph, and `require()` of a `.node` file embeds that addon. Files imported `with { type: "file" }` are embedded and exposed at `/$bunfs/root/…` paths, which are virtual, not on disk ([Bun: single-file executables](https://bun.sh/docs/compiler/executables.md)).
- Bun extracts an embedded `.node` to `$TMPDIR/.bun-<uid>-<hash>.node` (`/private/tmp` when `TMPDIR` is unset) and reuses an existing file of the same size. This was observed locally with Bun 1.4.4: a same-size file with one byte flipped was loaded without re-extraction.
- Bun ad-hoc signs the binaries it compiles (observed: `flags=0x20002(adhoc,linker-signed)`).
- Writing an embedded addon into `~/Library/Application Support/…` with `readFileSync`/`writeFileSync`, then loading it with `process.dlopen`, worked in a local experiment. It took about 60 ms the first time and about 8 ms after. `copyFileSync` from `/$bunfs` fails with `ENOENT`.

**OMP's native addon and directories**

- The addon's loader (`@oh-my-pi/pi-natives/native/loader-state.js`, lines 166–191) tries, in order:
    - `getNativesDir()/<version>/`;
    - `~/.local/bin/`;
    - the bundled `native/` directory;
    - the executable's directory.
- `getNativesDir()` honours `PI_NATIVES_DIR` (absolute paths only) before falling back to `~/.omp/natives`. It never derives from OMP's `agentDir` (lines 62–76).
- A compiled build extracts an embedded addon into that versioned directory, but only when the build replaced `native/embedded-addon.js`, which is `null` on disk (`maybeExtractEmbeddedAddon`, lines 509–531). OMP's release build does the replacement with `natives/scripts/embed-native.ts`, which the published packages do not ship.
- OMP's `agentDir` option governs both reads and writes. It sets where OMP:
    - reads your settings, `models.yml`, extensions, skills, rules, AGENTS.md and credentials;
    - writes `agent.db`, `models.db`, `skill-descriptions.db` and `cache/`.

    Moving it would cut Pico off from the user's OMP configuration.

- `createAgentSession` accepts a `modelRegistry`, and `ModelRegistry`'s constructor accepts `cacheDbPath` (`dist/types/sdk.d.ts:54`, `config/model-registry.d.ts:67`), so the model cache can move on its own. No public option relocates `skill-descriptions.db`. OMP's logs (`~/.omp/logs`) have no relocation option on macOS.

**Building OMP into one binary**

- OMP imports a virtual module, `omp-legacy-pi-modules`. Its build plugin generates a lazy `import()` map over every exported subpath of OMP's packages, so that extensions loaded at runtime by a compiled binary can import OMP's packages (`src/extensibility/plugins/legacy-pi-compat.ts:21-37`).
- The shipped plugin only works inside OMP's monorepo. A spike that replaced the module with an empty map compiled Pico into a 175 MB binary that passed Pico's real-model smoke test (18/18). It failed to load the addon in a clean environment.
- OMP's compiled build also inlines a docs index (`PI_DOCS_EMBED`) for `omp://` reads. Its generator reads a `docs/` directory that the published package does not ship.
- OMP's own release build, `scripts/compile-binary.ts`:
    - marks `fastembed` and `onnxruntime-node` external;
    - defines `PI_COMPILED=true`;
    - uses bytecode and splitting;
    - signs ad hoc.

**Signing and quarantine**

- Developer ID certificates and notarization require a paid Apple Developer Program membership ([Apple: certificates](https://developer.apple.com/support/certificates); [Developer ID certificate](https://developer.apple.com/help/glossary/developer-id-certificate); [Developer ID](https://developer.apple.com/support/developer-id)). Mark's membership is not current, so this proposal uses no Developer ID signing and no notarization.
- Homebrew quarantines every file a cask installs, while formulae and their bottles follow a different trust model and are not quarantined ([Security and supply chain](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain#casks-have-a-different-trust-model)). `--no-quarantine` was removed in Homebrew 6.0.14.
- On a Mac with SIP enabled, a quarantined command-line binary that is not notarized is blocked with "cannot be opened because the developer cannot be verified" until its quarantine attribute is removed ([ClickHouse](https://clickhouse.com/docs/resources/support-center/knowledge-base/troubleshooting/fix-developer-verification-error-in-macos), [this write-up](https://www.feliciano.tech/blog/macos-cannot-verify-developer/)). A contrary local test ran on this Mac, which has SIP disabled and boot-args that bypass AMFI, so it does not generalize.

**Homebrew formulae**

- `brew install markmals/tap/pico` tries a formula first, then a cask of that name. Naming the tap explicitly also grants trust to that formula ([Tap Trust](https://docs.brew.sh/Tap-Trust#installing-from-a-tap)).
- Homebrew core's `bun` formula is at 1.4.4, the version Pico pins, with an `arm64_golden_gate` bottle (`brew info bun`).
- A formula can later move to a cask in the same tap through `tap_migrations.json`, which Homebrew applies on update (`Tap#tap_migrations`, `tap.rb:1309`; `migrator.rb:202`).
- `brew upgrade` links the new keg. The old keg remains until `brew cleanup` removes it. A process keeps running after its executable and directory are deleted (observed).

**macOS's own `pico`**

- macOS ships `/usr/bin/pico`, the UW pico text editor, and `/usr/bin/nano` is a symbolic link to it (observed on this Mac).
- Homebrew's `/opt/homebrew/bin` normally precedes `/usr/bin` on `PATH`, so an installed `pico` shadows the editor for a terminal user. `nano` still opens the editor.

**The existing tap**

- `markmals/homebrew-tap` is public and holds formulae (`recon`, `remctl`, `vid`, `vite-plus`, `apple-platform-tools`). A pull request runs `brew test-bot`, which builds bottles on macOS runners and uploads them as artifacts.
- Adding the `pr-pull` label runs `brew pr-pull`, which publishes the bottles on a tap release and commits the formula's `bottle` block. `recon` is the model: built from a public source tag, ad-hoc signed, arm64 only, with a pinned macOS floor.
- No formula or cask named `pico` exists in Homebrew's core or cask repositories (`brew info pico`).

**Sesh**

- Sesh launches a custom agent by absolute executable path with no arguments, and speaks ACP over its stdin and stdout. Entries in `~/Library/Application Support/Sesh/agents.json` carry only `executable`, `id` and `name`. Oh My Pi is registered through a wrapper script (`~/.local/bin/omp-acp`) rather than `omp acp`.
- `AGENTS.md` forbids inventing a Sesh registration API.

### Relevant constraints and principles

- **Homebrew is the install path.** Mark decided that Homebrew is Pico's product install path, full stop, and that installed pieces may rely on Homebrew-provided locations. This revises the `VISION.md` goal of installing without a package manager, and the brief's rule against depending on Homebrew (`PROTOTYPE.md`, "End-user setup" and "Native macOS configuration app").
- **One executable, named `pico`.** The executable Sesh launches is `pico`, and later agent-first commands become subcommands of the same `pico`.
- **Nothing more leaves `~/.omp` yet.** Pico keeps reading the user's OMP configuration and credentials, and OAuth refresh keeps writing `agent.db`, as proposal 0001 approved. Only what public APIs can relocate without changing reads moves to Pico's directory.
- **No Developer ID and no notarization** until Mark has a paid Apple Developer Program membership. That makes a formula, not a cask, the working vehicle.
- **Public first.** The repository goes public under the MIT license before anything is published, because the formula and the tap's CI build from public source.
- **Publishing needs Mark's explicit confirmation** each time (`AGENTS.md` hard rules).
- **`pico` is the product, `mise` is not.** `pico` must behave exactly like the source build that proposal 0001 verified. Nothing at runtime may depend on mise, a Bun installation, a login shell or `PATH`.

### Quality bar

- **A real install:** on an Apple silicon Mac with SIP enabled and without the checkout, `brew install markmals/tap/pico` pours the bottle, and a Sesh session using `/opt/homebrew/bin/pico` passes the 0001 behaviors.
- **The same tests:** the compiled binary passes the same smoke run and ACP compatibility kit as the source build.
- **Formula checks:** the formula builds from source with `--build-from-source`, passes `brew test` and `brew audit --strict`, and its bottle installs from the tap's CI artifact.

### Remaining uncertainty

- **Will Homebrew's relocation step leave the binary intact?** When it pours a bottle, Homebrew rewrites build-prefix strings in installed files. A Bun-compiled payload must not contain any, so that the bottle is `cellar: :any_skip_relocation`. Implementation verifies this.
- **Will a newer Bun break the build?** Homebrew core's `bun` will move past 1.4.4. Implementation must state what a newer or older Bun does to the build; see Detailed design.
- **Can the model reach `omp://` docs through Pico's `read` tool** in the source build? If it can, `pico` must match; see Detailed design.
- **Do Pico sessions write OMP's `stats.db` or `autoqa.db`?** OMP's own harness on this Mac writes both, so whether Pico does is unattributed. Implementation must measure what a `pico` session writes under `~/.omp`.

## Existing baseline

- **`.build/pico-acp`** proves the adapter needs nothing beyond Bun and `node_modules`. It stays as the development launcher.
- **OMP's `scripts/compile-binary.ts`** is the closest prior art for building `pico`. Its embed and docs steps depend on unshipped monorepo files, so Pico reimplements those two against the installed packages.
- **`recon`** shows the whole distribution path that this proposal reuses:
    - a formula built from a public source tag;
    - ad-hoc signing;
    - arm64 only, with a pinned macOS floor;
    - bottles built by the tap's `brew test-bot` workflow and published by `brew pr-pull` when Mark labels the pull request.

## Proposed solution

Build `pico` from `adapter/main.ts` with a Pico-owned Bun build script. The script generates OMP's legacy module map from the installed packages and embeds the native addon. `pico` keeps the files it creates in `~/Library/Application Support/Pico`: the extracted addon and the model cache.

The tap gains a `pico` formula. It builds `pico` from a release tag with Homebrew's `bun` and gets arm64 bottles through the tap's existing CI and `pr-pull` flow.

```text
brew install markmals/tap/pico      → /opt/homebrew/bin/pico (bottle, ad-hoc signed)
Sesh custom agent → /opt/homebrew/bin/pico → ACP session, as in proposal 0001
pico --version                      → pico 0.1.0
brew upgrade pico                   → running sessions continue; new sessions get the new build
```

## Detailed design

### The `pico` executable

- `tools/build-pico.ts`, a zero-dependency Bun script, compiles `adapter/main.ts` into a single arm64 macOS executable. `mise run pico:build` runs it with output `.build/pico`. The formula runs it with Homebrew's `bun`.
- The build:
    - marks `fastembed` and `onnxruntime-node` external;
    - defines `process.env.PI_COMPILED` as `"true"`;
    - disables bunfig, dotenv, tsconfig and package.json autoloading in the binary;
    - keeps Bun's ad-hoc signature.
- The build fails, naming both versions, when the running Bun's major or minor version differs from the version in `mise.toml`. The formula therefore cannot silently produce a binary from an untested Bun. A tap update moves Pico's pinned Bun and Homebrew's together.
- The build resolves `omp-legacy-pi-modules` to a lazy `import()` map covering every exported subpath of the installed `@oh-my-pi/pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-coding-agent`, `pi-natives`, `pi-tui`, `pi-utils` and `typebox`, matching the map OMP's plugin generates. A user or project extension that imports one of those packages loads in `pico` as it does in the source build.
- The build replaces `@oh-my-pi/pi-natives/native/embedded-addon.js` with a module describing the embedded `pi_natives.darwin-arm64.node`, in the shape `loader-state.js` expects.
- **What `pico` does with its arguments:**
    - With no arguments and stdin not a terminal, `pico` is the proposal 0001 agent: ACP over stdin and stdout, with identical behavior. This is how Sesh launches it.
    - With no arguments and stdin a terminal, `pico` prints `usage: pico [--version]` and a line saying that Sesh launches `pico` as an ACP agent to stderr, then exits 2 without starting ACP.
    - `pico --version` prints `pico <version>`, a newline, and exits 0. The version is the `package.json` version, which is also the `agentInfo.version` Pico reports in `initialize`.
    - Any other argument makes `pico` print the usage line to stderr and exit 2, so `pico somefile` never waits for ACP input.
    - Later subcommands must keep the no-argument form as the ACP agent, because Sesh cannot pass arguments.
- `pico` reads nothing from the repository, mise or a Bun installation. A `pico` started with only `HOME`, `USER` and `PATH=/usr/bin:/bin` behaves as when Sesh starts it.
- If the source build lets the model read `omp://` documentation through the `read` tool, `pico` embeds the same documentation, so the read returns the same content. If the source build cannot read it, `pico` does not either. Implementation records which case holds.
- `mise run pico:smoke` and `mise run pico:tck` run the existing smoke test and compatibility kit against `.build/pico` instead of `.build/pico-acp`.
- `mise run pico:verify` starts `.build/pico` with only `HOME`, `USER` and `PATH=/usr/bin:/bin`. It checks that `--version` prints the `package.json` version and that an ACP `initialize` exchange returns the capabilities proposal 0001 specifies. It needs no credentials.

### Pico's data directory

- Pico's data directory is `~/Library/Application Support/Pico`. Pico creates it with mode `0700` when missing. Both `pico` and the development launcher use it for the files below.
- **Native addon.**
    - Before OMP's native loader runs, `pico` sets `PI_NATIVES_DIR` to `<data dir>/natives`. The addon then extracts to `<data dir>/natives/<pi-natives version>/pi_natives.darwin-arm64.node`.
    - Before loading an existing extracted file, `pico` compares its SHA-256 with the embedded bytes. A missing or mismatched file is rewritten through a temporary file and an atomic rename.
    - Extraction never uses `$TMPDIR`.
    - On start, `pico` refreshes the modification time of its own version directory. It then removes a sibling version directory under `<data dir>/natives` only when that directory's modification time is more than 10 minutes old, as Oh My Pi's own loader does. A process of another version that is starting refreshes its directory the same way, so cleanup never deletes an addon about to be loaded; a process already running keeps its loaded copy, because a mapped file outlives deletion. Entries that are not version directories, such as Oh My Pi's `grammars/`, are left alone.
    - The development launcher keeps loading the addon from `node_modules` and does not extract it.
- **Model cache.** Pico creates its session's `ModelRegistry` itself:
    - the user's credential store;
    - `<agentDir>/models.yml` read from the user's OMP agent directory;
    - the user's settings;
    - `cacheDbPath` set to `<data dir>/models.db`.

    Pico passes that registry to `createAgentSession`. Model resolution, availability and the 0001 model menus behave exactly as before.

- **Failures.** If the data directory or a file in it cannot be created or written, `pico` writes `pico: cannot use <path>: <cause>` to stderr and exits 1 before answering any ACP message. Sesh shows the agent's failure to start.
- **What stays in `~/.omp`:**
    - Reads of OMP settings, `models.yml`, extensions, skills, rules, AGENTS.md and credentials.
    - OAuth refresh writes to `agent.db`.
    - `skill-descriptions.db`, which no public option relocates.
    - OMP's logs in `~/.omp/logs`, which nothing relocates on macOS.

    Implementation lists every path a `pico` session writes under `~/.omp`, measured with a scratch `HOME`, in the guide's limits.

### Third-party notices and license

- `LICENSE` holds the MIT license, copyright Mark Malstrom.
- `tools/build-pico.ts` also writes `THIRD-PARTY-NOTICES.md` from the build's metafile. The file lists every package bundled into `pico`, with its name, version, license identifier and license text, plus the Bun runtime's license.
- The committed `THIRD-PARTY-NOTICES.md` is that generated file. `mise run pico:build` fails when its output differs from the committed copy, so a dependency change cannot ship stale notices.
- The formula installs `LICENSE` and `THIRD-PARTY-NOTICES.md` into the keg beside `bin/pico`.

### The `pico` formula

- `markmals/homebrew-tap` gains `Formula/pico.rb`:
    - `desc` and `homepage "https://github.com/markmals/pico"`;
    - `url "https://github.com/markmals/pico.git"` with the release `tag` and its `revision`, and `license "MIT"`;
    - `head "https://github.com/markmals/pico.git", branch: "main"`;
    - `depends_on "bun" => :build`, `depends_on arch: :arm64` and `depends_on macos: :sonoma` (macOS 14 or later).
- **Install.** It runs `bun install --frozen-lockfile --production` and then `bun tools/build-pico.ts`, writing the executable to `bin/pico`. It installs `LICENSE` and `THIRD-PARTY-NOTICES.md`. Lifecycle scripts stay blocked, as in `mise run setup`.
- **Test.** The `test` block checks that:
    - `pico --version` prints the formula's version;
    - `pico` with an unknown argument exits 2;
    - `codesign --verify` accepts `bin/pico`.
- **Caveats** say:
    - how to register Pico in Sesh (see Sesh registration);
    - that `pico` shadows macOS's `/usr/bin/pico` editor when Homebrew comes first on `PATH`, and that `nano` still opens the editor.
- **Bottles.** The tap's existing `tests.yml` builds arm64 bottles on a pull request, and `pr-pull` publishes them when Mark labels it. The bottle block that `pr-pull` commits is `cellar: :any_skip_relocation`. If relocation would alter the binary, implementation fixes the build rather than accepting a relocating bottle.
- **What install, upgrade and uninstall do:**
    - `brew install markmals/tap/pico` pours the bottle and links `/opt/homebrew/bin/pico`.
    - `brew upgrade pico` links the new keg. New Sesh sessions start the new build through the unchanged path; running sessions keep the old one until they end, even after `brew cleanup` removes its keg.
    - `brew uninstall pico` removes the keg and link and keeps the data directory. Removing `~/Library/Application Support/Pico` is a documented manual step, because formulae have no `zap`.

### Releases

- **Versions.** They come from Changesets: `mise run version` bumps `package.json`, `CHANGELOG.md` and `Config/Version.xcconfig`, and lands through a pull request. The first release is `v0.1.0`.
- **A release** proceeds as follows:
    1. A tag `v<version>` is pushed from `main` after the version pull request merges. Pushing the tag is the confirmation publishing requires, and it is Mark's act or done on their explicit instruction.
    2. A tap pull request updates `Formula/pico.rb` to the new `tag` and `revision`. The tap's CI builds and tests the bottles.
    3. Mark adds `pr-pull`, which publishes the bottles and commits the bottle block.

    There is no release workflow in the Pico repository.

- **Pico's CI.** Once Actions are enabled, `ci.yml` also runs `mise run pico:build` and `mise run pico:verify` on its macOS job. A broken compile or a stale notices file fails the pull request.

### Sesh registration

- Neither the formula nor `pico` registers Pico with Sesh or edits Sesh's files.
- The formula's caveats and the guide give Sesh's supported path: Settings › Machines › this Mac › Details… › Add an Agent… › Custom…, name "Pico", executable `/opt/homebrew/bin/pico`. That path survives upgrades.

### Making the repository public

- Before the first preview build:
    1. `LICENSE` and the generated `THIRD-PARTY-NOTICES.md` are committed.
    2. Mark confirms making `markmals/pico` public. The visibility change happens only after that confirmation.
    3. GitHub Actions is re-enabled with `gh api -X PUT repos/markmals/pico/actions/permissions -F enabled=true`.

### Documents

- `guides/running-pico-in-sesh.md` gains:
    - installation with `brew install markmals/tap/pico`;
    - registration with `/opt/homebrew/bin/pico`;
    - upgrades, uninstall and removing the data directory;
    - the `/usr/bin/pico` shadowing;
    - the data directory;
    - the `~/.omp` writes that remain.

    The checkout and `mise run acp:launcher` remain the development path.

- `AGENTS.md` and `README.md` describe:
    - `pico`, its tasks and the release steps;
    - the tap formula;
    - that builds are ad-hoc signed and not notarized, replacing "Nothing is signed… there is no distribution or notarization path here" and "There is no release or deploy task at all".
- `PROTOTYPE.md`'s "End-user setup" row and its app section say that Homebrew is the install path and that installed pieces may rely on Homebrew-provided locations.
- In Phase 5, `VISION.md`'s goal changes from installing "without a terminal, a package manager, or a hand-edited configuration file" to installing and updating through Homebrew, with configuration in the native app.

## Compatibility

- **Development is unchanged:** the source launcher and `mise` tasks keep working. Existing `pico-dev` registrations pointing at `.build/pico-acp` keep working.
- **The model cache starts empty:** Pico's sessions stop updating `~/.omp/agent/models.db` and use `~/Library/Application Support/Pico/models.db`. The first session after upgrading refills it. Terminal OMP is unaffected.
- **Extracted addons move:** extraction goes to Pico's data directory. Earlier source builds never extracted one, so there is nothing to migrate.
- **The system editor is shadowed:** a terminal user with Homebrew first on `PATH` gets Pico instead of macOS's `pico` editor. `nano` and `/usr/bin/pico` still open it.

## Implications on adoption

- Users need Homebrew 6 or later on an Apple silicon Mac running macOS 14 or later, and they trust the tap by naming it.
- Releases need, from Mark: the repository made public and Actions enabled. Apple accounts and signing secrets are not needed.
- Adoption reverses with `brew uninstall pico`, deleting `~/Library/Application Support/Pico`, and removing the Sesh agent entry. Making the repository public cannot be fully reversed: published code and bottles may have been copied.

## Scope

- `tools/build-pico.ts`, including the legacy module map, the embedded addon module, the Bun version check and notices generation, with tests.
- `pico` argument handling: ACP when stdin is not a terminal, usage otherwise, `--version`, and usage errors.
- The data directory, addon extraction with verification and cleanup, and the relocated model cache, with tests.
- The `pico:build`, `pico:verify`, `pico:smoke` and `pico:tck` tasks, plus the CI job that runs `pico:build` and `pico:verify`.
- `LICENSE` and `THIRD-PARTY-NOTICES.md`.
- `Formula/pico.rb` in the tap.
- Documents: the guide, `AGENTS.md`, `README.md` and `PROTOTYPE.md`.
- Verification:
    - `pico` smoke and compatibility kit, in clean environments;
    - an extension that imports `@oh-my-pi/pi-coding-agent`, loaded by `pico`;
    - a measured list of `~/.omp` writes;
    - the preview bottle installed and exercised in Sesh;
    - an install on a Mac or VM with SIP enabled.

### Out of scope

- Developer ID signing, notarization and a cask. They wait for a paid Apple Developer Program membership.
- The macOS settings app and agent-first `pico` subcommands.
- Intel Macs and Linux. OMP's installed natives package and the tap's conventions are arm64 macOS.
- Moving credentials, OMP configuration, `skill-descriptions.db` or logs out of `~/.omp`. That needs a Pico-owned credential store (`pico-awc`) or OMP API changes.
- Registering Pico with Sesh automatically, which needs a supported Sesh path.
- Publishing the first release. It follows this proposal's acceptance, with Mark pushing the tag and labelling the tap pull request.

## Preview

- **Artifact:** the arm64 bottle that the tap's `brew test-bot` workflow builds on a tap pull request. That pull request adds `Formula/pico.rb` pinned to this pull request's head `revision` of the now-public repository.
- **Access:**
    1. Mark downloads the bottle artifact with `gh run download` and runs `brew install ./pico--<version>.arm64_<os>.bottle.tar.gz`.
    2. They register `/opt/homebrew/bin/pico` in Sesh as "Pico" and exercise the 0001 behaviors and the model menus.
    3. `pico --version` prints the version, and `~/Library/Application Support/Pico` holds the extracted addon and `models.db`.
    4. `brew install --build-from-source markmals/tap/pico`, with the tap pull request's branch checked out in `$(brew --repo markmals/tap)`, shows that the formula builds.
- **Reason:** a bottle built by the tap's own CI from this revision is exactly what users will pour. Nothing is published before acceptance: the tap pull request stays unlabelled, so no bottle is released.
- **Cleanup:** `brew uninstall pico`, delete `~/Library/Application Support/Pico`, delete the downloaded bottle, close the tap pull request or retarget it to the first release, and remove the Sesh agent entry.

## Policies and decisions checked

- `policies/` and `decisions/` contain only their index READMEs, so no recorded policy or decision applies.
- `VISION.md` conflicts with this proposal: its goal says Pico installs "without a terminal, a package manager, or a hand-edited configuration file". Mark resolved this by making Homebrew the install path, and the goal changes in Phase 5. Distributing bottles through the tap is not the hosted service or deployment pipeline that the vision's non-goals exclude.
- `PROTOTYPE.md`'s rule against depending on Homebrew is revised as described under Documents.

## Future directions

- The settings app, once a paid Apple Developer Program membership allows Developer ID signing and notarization. It would ship in a `pico` cask that also carries the `pico` binary. `tap_migrations.json` would move existing formula installs to the cask, so `brew install markmals/tap/pico` keeps working.
- Agent-first `pico` subcommands alongside the no-argument ACP agent.
- A Pico-owned credential store and configuration (`pico-awc`), which would let Autonomous sessions work and remove Pico's remaining writes to `~/.omp`.
- Intel builds, if OMP's x64 natives and a need appear.

## Alternatives considered

- **A cask with Developer ID signing and notarization.** This was the first choice, because the settings app will need a cask. It requires a paid Apple Developer Program membership, which Mark does not currently have.
- **An unsigned cask.** Homebrew quarantines cask files, so every install and upgrade would need `xattr -d com.apple.quarantine` before Sesh could launch `pico` on a Mac with SIP enabled.
- **A long-running daemon managed by launchd**, named `picod`, with a relay that Sesh launches. Sesh speaks ACP only to a process it launches over stdio, so a daemon needs a relay and a socket protocol, and nothing needs persistent state yet.
- **Shipping the addon beside the binary.** `pico` would load `pi_natives…node` from its own directory, with no extraction. Mark chose a single file with Pico-owned extraction.
- **Letting Bun extract the addon.** Bun writes to `$TMPDIR`, which is world-writable `/private/tmp` when unset, and reuses a tampered file of the same size.
- **Moving OMP's whole `agentDir` to Pico's directory.** That moves every read away from the user's configuration and credentials.
- **A different executable name.** It would avoid shadowing macOS's `pico` editor, but Mark chose `pico`.
- **Holding distribution until signing exists.** The formula works today without signing, and the cask can follow.

## Open questions

- None.
