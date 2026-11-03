---
id: proposal.0007
title: Pico-Owned Configuration
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/46
issues: [https://github.com/markmals/pico/issues/12]
supersedes: []
---

# Pico-Owned Configuration

## Summary

Pico gets a versioned settings file that `pico` validates and saves atomically, and that the Mac app changes through `pico`. Its first setting is the default model and reasoning level for new Sesh sessions. Pico sessions stop reading the user's OMP configuration files, extensions and OMP-only prompt sources.

## Motivation

Pico has no configuration of its own. Every session starts from the user's OMP configuration for its working directory: the model and thinking level OMP's settings resolve, every other OMP setting, custom models from `models.yml`, user and project extensions and hooks, and OMP's skills, rules, prompts and commands ([proposal 0001](0001-acp-adapter-core.md#sessionnew)). Pico adds its fixed policy on top and writes nothing. To make Pico start on a different model, a user has to change OMP's configuration, which also changes terminal OMP, or pick a model in every Sesh session.

The Mac app was built to fix that, but its controls are unconnected ([proposal 0005](0005-mac-app-ui-workspace.md)). It has a Models pane with a default-model picker, a reasoning-level picker and an Available models list, and a General pane with a Settings file row. All of them wait for [issue #12](https://github.com/markmals/pico/issues/12): one versioned configuration contract that the app and the adapter both understand, with validated, atomic saves, app defaults kept apart from a session's own choices, and secrets kept out of ordinary files.

Mark chose the first slice of #12 on 2026-11-02: the contract and the default model. Credential references come next, in their own proposal designed with the Autonomous credential store ([#7](https://github.com/markmals/pico/issues/7)), so #12 stays open after this one. Mark also decided that once Pico has its own configuration, OMP-specific configuration must stop affecting Pico: OMP's settings files, `models.yml`, OMP extensions, and the skills, rules, prompts and commands OMP finds under `~/.omp` and a project's `.omp`. Pico's settings, Pico's fixed policy and OMP's built-in defaults decide how a Pico session behaves. Mark also chose to remove the app's sample-data mode instead of keeping it next to real values.

## Domain grounding

### Established context

- **The SDK can configure a session without reading the user's files** (`@oh-my-pi/pi-coding-agent` 18.14.0):
    - `Settings.isolated(overrides)` builds settings from OMP's built-in defaults plus the overrides. It reads no global or project configuration file and never persists (`src/config/settings.ts:760-768`). Settings bound to environment variables, such as `PI_EDIT_VARIANT`, still read the process environment (`src/config/registry.ts:463-541`).
    - `Settings.loadReadOnly`, which Pico uses today, reads global and project configuration (`settings.ts:745`). Neither path writes the user's files.
    - OMP's built-in defaults: `modelRoles` is empty, and `defaultThinkingLevel` is `high`, with valid values `minimal`, `low`, `medium`, `high`, `xhigh`, `max` and `auto` (`src/config/model-settings.ts:109`, `src/session/settings.ts:240-244`).
    - `createAgentSession` accepts an explicit `model` and `thinkingLevel`. Without them it resolves the `default` model role from settings. With no role configured it takes the first model in its own order that has usable credentials and reports no fallback message. With a role configured that it cannot use, it substitutes another model and says so in `modelFallbackMessage` (`src/sdk.ts:590-615, 3440-3494`). Pico already fails `session/new` when that message appears (`adapter/engine/pico-session.ts:140-145`).
- **The catalog is available without a session.** `new ModelRegistry(authStorage, modelsPath, { ignoreLocalModelConfig, settings, cacheDbPath })` loads the bundled and cached catalog synchronously. `getAvailable()` filters it to models whose provider has usable credentials, with no network request and no OAuth refresh (`src/config/model-registry.ts:537-556, 3144`). `ignoreLocalModelConfig: true` skips `models.yml` entirely (`model-registry.ts:1731-1749`). `getSupportedEfforts(model)` gives a model's reasoning levels without a session (`@oh-my-pi/pi-catalog/src/model-thinking.ts:23`).
- **OMP-specific discovery comes from three capability providers.** `native` (`src/discovery/builtin.ts:40-43`) produces every skill, rule, slash command, prompt, system prompt file, context file, hook, extension module, custom tool, settings file and MCP file under `~/.omp/agent` and a project's `.omp`. `omp-plugins` produces configured extension packages, and `omp-managed` produces auto-learned skills under `~/.omp/agent/managed-skills`. The `disabledProviders` setting excludes them, and `createAgentSession` binds it to the capability registry (`sdk.ts:1802-1806`, `src/capability/index.ts:351-443`). Prompt templates are a separate, hardcoded scan of `~/.omp/agent/prompts` and `.omp/prompts` that only `promptTemplates: []` replaces (`src/config/prompt-templates.ts:160-178`). `AGENTS.md` files (provider `agents-md`), `.agent` and `.agents` directories (`agents`), and other harnesses' directories (`claude`, `codex`, `cursor` and others) belong to other providers.
- **Restricted sessions run no ambient extension discovery** (`sdk.ts:2770-2900`). Pico reaches user and project extensions only because `adapter/engine/session-extensions.ts` runs that discovery itself.
- **Sesh 0.29.0**, observed in its files on 2026-11-02:
    - Sesh keeps config choices per session. Each session's `session.json` holds a `preferredConfig` with only the options the user changed. No Sesh file holds a per-agent default; its user defaults keep a list of recent model choices for the picker.
    - A captured trace shows one `session/set_config_option` after `session/new`, and again after `session/resume`, before the first prompt, sending the session's `preferredConfig`. Three `pico-dev` sessions have no `preferredConfig`, so they ran on Pico's own choice.
    - Sesh probes agents and caches their config options, including the current value, in `agent-probes.json`.
- **OMP's `models.db` cache already lives in Pico's data directory**, and so do Pico's journals, the extracted native addon and OMP's runtime storage (`adapter/data-dir.ts`, `adapter/engine/runtime-storage.ts`). `adapter/native-addon.ts:59-72` writes a file atomically: write a temporary file, rename it over the target, remove the temporary file on failure.

### Relevant constraints and principles

- **Never fall back silently.** A model, file or helper that cannot be used fails with its cause.
- **Never rewrite the user's OMP configuration or credentials.** Pico reads the user's credential store in place and writes no OMP file.
- **One parser.** Mark chose `pico` as the only reader and writer of the settings file. The app learns the settings and the catalog only from `pico`.
- **Swift gets no second provider engine** ([PROTOTYPE.md](../PROTOTYPE.md#configuration-and-credentials)). The app shows the catalog `pico` reports and validates nothing about models itself.
- **A setting exists only if it changes a real capability.** The default model and reasoning level change what a new session runs on. No other setting is added.
- **Every unconnected control stays visibly unconnected** until the work that connects it ([proposal 0005](0005-mac-app-ui-workspace.md#stub-boundary)).

### Quality bar

Choosing a default model in the app changes the model the next new Sesh session starts on, without restarting anything, and without changing a session that is already open or that was given a model in Sesh. Quitting and reopening the app shows the same choice. A save that fails leaves the previous file byte-for-byte unchanged and tells the user why. Nothing under `~/.omp`, other than the credential store Pico already reads, affects a Pico session. Terminal OMP's configuration is never written.

### Remaining uncertainty

- Sesh's model picker for a new session shows the value Sesh cached when it last probed Pico. After the default changes, that cached value can be stale until Sesh probes again or the session starts. The session then reports the model it actually started on. Whether Sesh sends the cached value as an explicit choice, which would override Pico's default, has to be observed in the preview.
- The app launches `pico` with the app's environment, not a login shell's. A provider whose only credential is a shell environment variable can be available to Sesh sessions but missing from the app's catalog.
- The helper lists the cached catalog without waiting for a network refresh. On a machine whose cache is empty, a model that only network discovery finds appears after a session has refreshed the cache.

## Existing baseline

The adapter's model handling is the baseline to preserve. A new session starts on one model, a model OMP would substitute is a failure (`pico-session.ts:130-145`), `session/set_config_option` changes the model or thinking level for that session only, through `setModelTemporary` and a non-persisting `setThinkingLevel` (`pico-session.ts:176-178`), and a reopened session takes its model and level from its own journal, failing when that model is no longer available ([proposal 0004](0004-session-restoration.md)). Those rules stay. What changes is where the starting choice comes from.

`loadPicoSettings` (`adapter/engine/pico-settings.ts`) loads the user's settings read-only and overlays Pico's policy. Its policy keys stay. Its clearing of the user's per-tool approval policies exists only because user settings were loaded, and it goes away with them. `session-extensions.ts` and its tests exist only to run user and project OMP extensions, and they go too. The Bun patch from proposal 0004 (`patches/@oh-my-pi%2Fpi-coding-agent@18.14.0.patch`) threads the user's original configuration directory through native discovery of skills, context files, system prompts and extensions. With native discovery disabled, nothing Pico uses depends on it, and the original directory is needed only to open the credential store.

The `pico` executable accepts only `--version` and bare ACP invocation (`adapter/invocation.ts`). There is no settings file and no helper channel.

The app's Models pane already has the shape this proposal connects. `DefaultModelPickerRow`, `ReasoningLevelPickerRow` and `AvailableModelRows` (`app/Panes/ModelRows.swift`) render either a disabled stub or sample values. The sample rule for switching models keeps the reasoning level when the new model offers it and otherwise uses that model's default level (`app/Sample/SampleSettings.swift:69-75`), and the connected pane keeps it. `SettingsFileRow` already shows a path on one line with Show in Finder and Copy Path. Everything under `app/Sample/`, the provider list, provider pages, the Add Provider sheet, provider tiles and logos, the View › Show Sample Data command and the `-ShowsSampleData` argument exist only for sample data.

## Proposed solution

`pico` owns one JSON file, `~/Library/Application Support/Pico/settings.json`, with a version number and, for now, one setting: the default model and its reasoning level. `pico settings` prints the settings and the catalog as JSON. `pico settings set-default-model` validates a choice against that catalog and saves it atomically. The app runs those two commands and nothing else. Its Models pane shows the real catalog and saves each choice as it is made, as System Settings does. Its General pane shows the real settings file.

Each `session/new` reads the file and starts the session on the saved model and level. A model chosen in Sesh still wins for that session, and a reopened session still keeps its own. Pico sessions stop reading OMP's settings files, `models.yml`, extensions and OMP-only prompt sources, so the Models pane is the one place that decides what a new Pico session starts on.

```text
Models › Model: choose "Claude Sonnet 5.5 (anthropic)" → settings.json now names anthropic/claude-sonnet-5-5 and its level
Quit and reopen Pico.app → Models shows the same model and level
New session in Sesh → its Model selector reads Claude Sonnet 5.5 and the first reply comes from it
A session that picked GPT in Sesh, reopened → still on GPT
pico settings set-default-model openai/no-such-model high → exit 1 with the reason, settings.json unchanged
```

## Detailed design

### Concepts

- **Pico settings:** the document in `settings.json`. It holds only non-secret settings. It belongs to the user's Pico installation, not to a project or a session.
- **Default model:** a model and a thinking level, saved together in Pico settings. It decides what a new session starts on. Its model value is the `provider/id` string Pico's Model option sends Sesh, and its thinking value is one of the values Pico's Thinking option offers for that model.
- **Session choice:** a model or thinking level set on one session through `session/set_config_option`. It belongs to that session and its journal, never to Pico settings.
- **Catalog:** the models a new Pico session can use at that moment, in the order Pico's Model option lists them. It is OMP's bundled and cached catalog filtered to models with usable credentials, without `models.yml`. With OMP configuration files no longer read, the catalog no longer depends on the project.
- **Settings helper:** the `pico settings` commands, the app's only access to Pico settings and the catalog.

### The settings file

- Its path is `<data directory>/settings.json`, which is `~/Library/Application Support/Pico/settings.json` for the user running `pico`. It does not exist until the first save.
- Version 1 is a JSON object with exactly these members:

    ```json
    {
        "version": 1,
        "defaultModel": { "model": "anthropic/claude-sonnet-5-5", "thinking": "high" }
    }
    ```

    - `version` is required and is the integer `1`.
    - `defaultModel` is optional. When present it is an object with exactly two members, `model` and `thinking`, both non-empty strings.

- Reading the file yields one of four states:
    - **Missing:** there is no file. No default model is saved.
    - **Valid:** the shape above. `defaultModel` may be absent.
    - **Unsupported:** an object whose `version` is an integer greater than 1. Its problem reads that the file was written by a newer version of Pico.
    - **Invalid:** anything else, including a file that is not UTF-8 JSON, is not an object, lacks `version`, has a member of the wrong type, or has a member the version does not define. Its problem names the file and the first thing wrong with it.
- Reading checks shape only. Whether the saved model can be used is checked when a session starts and when a choice is saved.
- Only `pico settings set-default-model` writes the file. A save:
    1. reads the current file, and refuses to save when it is unsupported or invalid, saying the file must be fixed or removed first. Pico never overwrites a file it cannot read;
    2. validates the choice against the catalog: the model must be in the catalog, and the thinking value must be one the model offers;
    3. creates the data directory with mode `0700` if it is missing;
    4. writes the complete document, as 4-space-indented JSON with a trailing newline, to a temporary file in the data directory, flushes it to disk, and renames it over `settings.json`;
    5. removes the temporary file if any step fails, and reports the cause.
- A failed save of any kind leaves the previous file exactly as it was, or absent if it was absent. Two concurrent saves leave whichever finished last. A reader always sees a complete document.
- Pico writes no secret into the file, and the file holds nothing but the members above.

### What a Pico session reads

- Every Pico session, new or reopened, uses `Settings.isolated` with Pico's existing policy overrides (eval, LSP, delegation depth, approval mode, restricted folders, `todo` and title refresh) and nothing from the user's global or project OMP settings. Every other setting takes OMP's built-in default. Settings that OMP binds to environment variables keep reading the environment `pico` was launched with.
- The model registry uses the bundled catalog, discovery for providers with usable credentials, and its cache in Pico's `models.db`. It ignores `models.yml`.
- Pico disables the `native`, `omp-plugins` and `omp-managed` discovery providers and passes no prompt templates. A Pico session therefore loads no skill, rule, slash command, prompt, prompt template, system prompt file, context file, hook, extension or custom tool from `~/.omp/agent` or a project's `.omp`, and no auto-learned skill. `AGENTS.md` files, `.agent` and `.agents` directories, and other harnesses' directories load exactly as before.
- Pico no longer discovers or loads OMP extensions. Its own write-bridge extension is unchanged.
- Pico still opens the user's OMP credential store in place, from the user's original OMP configuration directory, which is now the only thing that directory is used for. Credential handling is unchanged.
- Remove the proposal 0004 SDK patch and the code that threads the original configuration directory through discovery. The isolation tests below pin that project `AGENTS.md` and `.agents/skills` keep loading after the patch is gone.
- Sesh-supplied MCP servers, the tool roster and its checks, the write bridge, restoration, and stdout isolation are unchanged.

### Starting a session

- `session/new` reads `settings.json` each time, so a save applies to the next new session without restarting `pico`.
    - **Valid with a default model:** the session starts on that model at that thinking level, and its config options report both. If the model is not in the catalog, or the model does not offer that thinking value, `session/new` fails with an error that names the saved model and says to choose another default in Pico's Models settings. No session is created, and no other model is substituted.
    - **Missing, or valid without a default model:** the session starts on OMP's built-in choice, the first model in OMP's own order that has usable credentials, at OMP's built-in thinking level. Mark noted that Sesh makes the user pick a model before starting a session, and Sesh learns its choices from Pico's response to `session/new`. Failing here would leave Sesh with no models to offer. If no model has usable credentials, `session/new` fails as it does today.
    - **Unsupported or invalid:** `session/new` fails with the file's problem and its path. No session is created.
- `session/set_config_option` is unchanged. It changes that session alone and is never written to Pico settings.
- `session/load` and `session/resume` do not read `settings.json`. A reopened session starts on its journal's model and thinking level, as [proposal 0004](0004-session-restoration.md) specifies, whatever the default is now, and an invalid settings file does not stop a session from reopening.
- A Sesh child session that Pico starts is a new session like any other.

### Thinking choices for a model

- A model's thinking choices are the options Pico's Thinking option offers for it: Off, then Auto, then the model's supported reasoning levels in OMP's order. One pure function of a model produces them for both the config option and the helper, so the app and Sesh cannot offer different lists.
- A model's default thinking level is the value Pico's Thinking option shows when a session starts on that model with no level chosen: Off for a model without reasoning, and otherwise OMP's built-in default, `high`, adjusted to the nearest level the model supports, as OMP adjusts it.

### The settings helper

- `adapter/invocation.ts` accepts two new forms, whatever stdin is:
    - `pico settings` prints the report.
    - `pico settings set-default-model <model> <thinking>` saves the default model, then prints the report.
    - Any other arguments after `settings` are a usage error, exit status 2, with the usage on stderr. The usage line lists the new forms. Bare `pico` and `pico --version` are unchanged.
- The helper uses the same data directory, credential store and catalog construction as `session/new`. It loads the native addon as the agent does, makes no network request of its own, and writes nothing except a save and the caches `pico` already keeps.
- Stdout carries exactly one JSON document and a newline. Stdout is isolated as it is for the agent, so nothing else reaches it, and diagnostics go to stderr.
- On success the exit status is 0 and the document is the report:

    ```json
    {
        "version": 1,
        "settingsFile": "/Users/mark/Library/Application Support/Pico/settings.json",
        "settings": {
            "status": "valid",
            "defaultModel": { "model": "anthropic/claude-sonnet-5-5", "thinking": "high" }
        },
        "models": [
            {
                "value": "anthropic/claude-sonnet-5-5",
                "name": "Claude Sonnet 5.5",
                "thinking": [
                    { "value": "off", "name": "Off" },
                    { "value": "auto", "name": "Auto" },
                    { "value": "low", "name": "low" },
                    { "value": "high", "name": "high" }
                ],
                "defaultThinking": "high"
            }
        ]
    }
    ```

    - `version` is the helper protocol's version, 1.
    - `settings.status` is `missing`, `valid`, `unsupported` or `invalid`. `valid` carries `defaultModel`, which is `null` when none is saved. `unsupported` and `invalid` carry `problem`.
    - `models` is the catalog, in order. Each model's `value`, `name` and `thinking` entries are exactly what Pico's Model and Thinking options would send Sesh, and `defaultThinking` is the model's default thinking level.

- On failure the exit status is 1 and the document is `{ "version": 1, "error": "<message>" }`. Failures include a credential store that cannot be opened, a choice that fails validation, a settings file that is unsupported or invalid when saving, and a write that fails, with the operating system's cause. A failed command changes nothing.

### The Mac app

#### Finding `pico`

- The app runs the executable named by the `-PicoExecutable <path>` launch argument when one is given, reading the argument domain only, never saved defaults. Otherwise it runs the first executable file of `/opt/homebrew/bin/pico` and `/usr/local/bin/pico`.
- `mise run macos:run` builds `.build/pico` with the `pico:build` task, then opens the app with `-PicoExecutable` set to that file, so a development build exercises the checkout's `pico`.
- When no executable is found, the app does not run anything. The Models pane shows that `pico` was not found at those locations and that Homebrew installs it.

#### Running the helper

- The app runs `pico` with the arguments above, no stdin, and the app's own environment, off the main thread, and decodes stdout as one JSON document.
- A run that has not finished within 30 seconds is terminated and reported as "`pico` did not answer within 30 seconds".
- A document whose `version` is not 1 is reported as this `pico` speaking a different settings version, naming its path. A failure document's `error` is reported as it is. A run that exits without a JSON document is reported with the last lines of its stderr, or its exit status when stderr is empty.
- The app loads the report when its window opens and each time the Models pane is shown. A successful save replaces it with the report the save printed.

#### Models

- **Loading:** both pickers are disabled and read "Loading…".
- **Helper failure:** both pickers are disabled and read "Unavailable", and the Defaults section's footer shows the failure with a Try Again button that loads the report again.
- **Unsupported or invalid settings file:** both pickers are disabled and read "Unavailable", and the footer shows the problem, says to fix or remove the file, and has a Show in Finder button that reveals the file.
- **Report loaded, file missing or valid:**
    - The Model picker lists the catalog, each entry showing the model's name followed by its provider in parentheses, such as "Claude Sonnet 5.5 (anthropic)", because two providers can offer models with the same name.
    - With no saved default, the picker reads "Not Set" and the Reasoning level picker is disabled and reads "Not Set". "Not Set" cannot be chosen once a model is saved; a model must be chosen.
    - A saved model that is not in the catalog appears as its saved value followed by "(unavailable)", selected, and the footer says new sessions will fail to start until another model is chosen.
    - The Reasoning level picker lists the saved model's thinking choices and shows the saved value.
    - Choosing a model saves it at once, with the current reasoning level if the new model offers it and otherwise the new model's default thinking level. Choosing a reasoning level saves it at once, with the current model.
    - While a save runs, both pickers are disabled. A failed save shows an alert with its error, and the pickers keep showing the last saved values.
    - With an empty catalog, the Model picker is disabled and reads "None available", and the footer says no model has usable credentials.
    - The Defaults footer says that new Sesh sessions start with this model and reasoning level, and that sessions already open, and sessions given a model in Sesh, keep their own.
- **Available models** lists the catalog in order, each row showing the model's name and its `provider/id` value, with "Default" on the saved model. An empty catalog reads "None available". While loading or after a failure, the section reads "Unavailable".
- The Models pane shows no notice about unconnected settings, because it has none.

#### General › Settings file

- The row shows the report's `settingsFile` path on one line, truncated in the middle if it does not fit, as it does now. Before a report loads it reads "Loading…", and after a helper failure it reads "Unavailable".
- Show in Finder reveals the file selected in Finder when it exists, opens its folder when only the folder exists, and is disabled otherwise. Copy Path, in the row's context menu, copies the path whenever the row shows one.
- The Runtime and Versions rows stay unconnected.

#### Removing sample data

- Delete the sample-data mode: `app/Sample/` and its tests, the View › Show Sample Data command, the `-ShowsSampleData` launch argument, the sample-data notice, the provider list rows, provider pages, the Add Provider sheet, the sign-in menu, Sign Out, the sample Register and Unregister actions, provider tiles, and the provider logo assets with their notice, `app/ThirdPartyNotices.md`. Navigation no longer has provider pages, and the history rule for forgetting them goes with them.
- Every unconnected row keeps its unconnected stub. Providers & Accounts shows its Providers row reading "Not connected" and a disabled Add Provider… button, as it does today without sample data.
- The notice at the bottom of every pane except Models reads "Some settings aren't connected yet", with the same symbol and accessibility announcement as today's unconnected notice.
- Search, links, and item slugs are unchanged. No item is added or removed.

### Tests, guides and verification

- Write each test to fail first.
- Bun tests cover:
    - reading each file state, including an unknown member and a newer version;
    - a save that writes the expected document;
    - every refused save: a model outside the catalog, a thinking value the model does not offer, an invalid or unsupported current file, and a failed write. Each must leave the previous bytes unchanged, or no file;
    - the report's shape for each settings state, and the error document;
    - `session/new` starting on the saved default, failing on an unusable saved default and on an invalid file, and starting on OMP's built-in choice with no default;
    - a later save applying to the next `session/new` on the same connection;
    - `session/set_config_option` overriding the default for one session;
    - reopening a session on its own model whatever the default is, including when the settings file is invalid;
    - isolation: a scratch OMP configuration directory and project whose `config.yml`, project settings, `models.yml`, extensions, skills, rules, prompts, commands and `.omp/AGENTS.md` would each change a session, and none of them does, while the project's `AGENTS.md` and `.agents/skills` still load.
- Swift tests cover decoding each report form and the error document, rejecting another protocol version, the model-switch rule for the reasoning level, and the order in which `pico` is located.
- Extend `pico:verify` to run the compiled `pico settings` in its scratch home: report with no file, save a default for its offline test model, report again, start a session that uses it, and confirm that a refused save leaves the file unchanged.
- Revise `guides/running-pico-in-sesh.md` and `guides/refining-the-mac-app-ui.md` from this proposal before changing code. Say what Pico reads and no longer reads, how the default applies, and how the Models pane and the Settings file row work. Remove the sample-data material.
- Revise `AGENTS.md`, `PROTOTYPE.md`, `README.md` and `VISION.md` where they describe Pico applying its policy over the user's OMP configuration, the app's sample-data mode, or the app as configuring nothing. Add a changeset for the user-visible change.
- Run `mise run check` and `mise run pico:verify`, then exercise the preview below.

## Compatibility

- **Pico sessions lose everything they took from OMP's configuration files.** That covers OMP's default model and thinking level, project model settings, every other OMP setting (compaction, retries, provider options, enabled models, auth account-pool policy and the rest), custom models and providers in `models.yml`, user and project extensions and hooks, and OMP's skills, rules, prompts, commands, system prompt files and `.omp/AGENTS.md`. Terminal OMP is unaffected.
- **No migration.** Pico does not import OMP's default model into its settings, because Mark chose that a model must be chosen in the app. Until one is, new sessions start on OMP's built-in choice, and Sesh shows which model that is.
- **Existing sessions** reopen on their own journal's model. A session whose model came from `models.yml` fails to reopen with proposal 0004's unavailable-model error, because that model is no longer in Pico's catalog.
- **`pico`** gains the `settings` forms. Sesh's bare invocation and `--version` behave as before.
- **The app** loses its sample-data mode. `-ShowsSampleData` is no longer recognized and is ignored.
- **The settings file** is new. Version 1 is the first version, so nothing reads an older one.

## Implications on adoption

Users who want a particular starting model choose it once in the app. Running the app needs `pico` from Homebrew, or a development build passed with `-PicoExecutable`, which `mise run macos:run` does. Nothing is installed, registered or signed differently. Removing `settings.json` returns new sessions to OMP's built-in choice. Reverting this change restores reading OMP's configuration. The settings file is left in place and ignored by older versions of `pico`.

## Scope

- The versioned settings file, its validation, and atomic saves.
- `pico settings` and `pico settings set-default-model`.
- New sessions starting on the saved default, with session choices and reopened sessions unchanged.
- Pico sessions no longer reading OMP's settings files, `models.yml`, OMP extensions and hooks, or OMP-only skills, rules, prompts and commands, plus removing the code and SDK patch that only served them.
- The app locating and running `pico`, and the Models pane and Settings file row connected to it.
- Removing the app's sample-data mode, and the notice wording that follows from it.
- Tests, `pico:verify`, guides, the contract, brief, README and vision wording, and a changeset.

### Out of scope

- **Credentials.** Credential references, Pico-managed secrets, the Keychain, sign-in and the Providers & Accounts pane belong to the next slice of #12, designed with #7 (Beads `pico-bfk.4`). This slice stores no secret and reads credentials exactly as today.
- **Other settings.** No other OMP setting becomes a Pico setting, and there are no per-project defaults. Each needs a capability and its own approved intent.
- **Live changes.** Changing the default never changes a session that is already running or a reopened one.
- **Environment variables.** Pico does not clear OMP settings that the launching environment sets.
- **Runtime readiness and versions, `intellisense`, Sesh registration and diagnostics.** These rows stay unconnected.
- **Bundling `pico` in the app, distributing the app, signing and notarization.**
- **A long-lived helper channel.** The two commands are enough for this slice. Sign-in flows that need progress and cancellation decide their own channel.

## Preview

- Repository shape: a native macOS app and a CLI executable.
- Artifact: the Debug `Pico.app` built and opened by `mise run macos:run`, running this checkout's `.build/pico`, and a real Sesh session driven by the registered development launcher, `.build/pico-acp`, which runs this checkout's adapter. The app and the adapter are the two surfaces that change, and criterion 15 needs both together.
- Access: the local checkout. Nothing is published, installed over Homebrew's `pico`, or registered differently in Sesh.
- Exercise:
    - Open the app. Models shows the real catalog and "Not Set". Choose a model and a reasoning level.
    - Quit and reopen the app. Both values are still shown.
    - Start a new Sesh session. It starts on the chosen model and level, and a prompt is answered by it. Observe what Sesh's picker shows before the session starts.
    - In an older session, choose a different model in Sesh, close it, reopen it, and confirm it keeps that model.
    - Make a save fail, for example by making the data directory read-only, and confirm the alert and that `settings.json` is unchanged.
    - Confirm that a `config.yml` default model and a user extension no longer affect a new session.
    - Check that sample data is gone and the notice reads correctly.
- Completion cleanup: restore any permission changed for the failed save, and leave `settings.json` holding the human's choice. No account or registration needs cleanup.

## Policies and decisions checked

- Formal policy records: None. `policies/` contains only its index.
- Formal decision records: None. `decisions/` contains only its index.
- [VISION.md](../VISION.md): configuration is native and truthful, the app offers models from OMP's available catalog, and settings exist only when backed by real capabilities. This proposal keeps all three. Its description of the app as configuring nothing is updated on acceptance.
- [PROTOTYPE.md](../PROTOTYPE.md): its Configuration runtime decision and [Configuration and credentials](../PROTOTYPE.md#configuration-and-credentials) section apply Pico's policy "over the user's normal OMP configuration". Mark's decision replaces that with Pico's settings and fixed policy over OMP's built-in defaults, reusing only credentials. The brief is revised to match, and its sample-data exception is removed.
- `AGENTS.md`: the hard rule "Apply Pico's policy per process and per session over the user's normal configuration" is revised the same way. Never rewriting the user's OMP configuration or credentials still holds. The sample-data exceptions in its no-fabricated-capability, no-build-only-source and no-manufactured-credentials rules are removed.
- [Proposal 0001](0001-acp-adapter-core.md): its `session/new` rules that start on the model the user's OMP configuration resolves, keep user and project extension hooks working, and read the user's OMP settings read-only are replaced by this proposal's. Its rule that Pico substitutes no model is kept.
- [Proposal 0004](0004-session-restoration.md): restoration is unchanged. Its SDK patch and the threading of the original configuration directory into discovery are removed, because discovery no longer reads that directory. The directory is still used for the credential store.
- [Proposal 0005](0005-mac-app-ui-workspace.md): its sample-data mode, provider pages and provider logos are removed at Mark's direction. Its Models pane and Settings file row are connected. Its search items, slugs and links are unchanged. Its future direction said that connecting real configuration would decide what happens to sample data, and Mark decided.
- [Proposal 0006](0006-todo-plan-updates.md): its pinned `todo` and title overrides stay. `todo.eager` and `todo.remindersMax`, which followed the user's OMP configuration, now take OMP's built-in defaults.

## Future directions

- Credential references and Pico-managed secrets, through this file and this helper, designed with #7.
- Further Pico settings, such as the `intellisense` location, each when it changes a real capability.
- A live change to running sessions, if Sesh gains a way to show one.

## Alternatives considered

- **The app parses and writes the file itself.** That needs two parsers and two validators kept in step. Mark chose `pico` as the only reader and writer.
- **Pico's default sits under a project's OMP model setting.** Mark decided that no OMP-specific setting should affect Pico.
- **An "Oh My Pi Default" picker entry.** Mark chose that a model must be chosen.
- **Keeping sample data for design review, or showing real values beside it.** Mark chose to remove it.
- **Failing `session/new` when no default is saved.** Sesh learns which models it can offer from Pico's `session/new` response, so failing would leave the user unable to pick one in Sesh.
- **Falling back to OMP's choice when the saved default cannot be used.** That would silently start a different model than the one the user chose, so it fails instead, as Pico already does for a configured model OMP cannot use.
- **A long-lived JSON-RPC helper.** Nothing in this slice streams or needs cancellation. A process per command is simpler and cannot outlive the app.
- **Storing settings in the app's user defaults.** The adapter could not read them without a second, Swift-specific format, and the brief places Pico's settings in Application Support.

## Open questions

None.
