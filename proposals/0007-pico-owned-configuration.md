---
id: proposal.0007
title: Pico-Owned Configuration
authors: [Mark Malstrom]
status: active-review
pull-request: https://github.com/markmals/pico/pull/46
issues: [https://github.com/markmals/pico/issues/12]
supersedes: []
---

# Pico-Owned Configuration

## Summary

Pico gets a versioned settings file. `pico` validates and saves it atomically through agent-first commands: discoverable, schema-described and JSON by default. Its first setting is the default model and reasoning level for new Sesh sessions. Pico sessions stop reading the user's OMP configuration. Connecting the Mac app follows separately.

## Motivation

Pico has no configuration of its own. Every session starts from the user's OMP configuration for its working directory: the model and thinking level OMP's settings resolve, every other OMP setting, custom models from `models.yml`, user and project extensions and hooks, and OMP's skills, rules, prompts and commands ([proposal 0001](0001-acp-adapter-core.md#sessionnew)). Pico adds its fixed policy on top and writes nothing. To make Pico start on a different model, a user has to change OMP's configuration, which also changes terminal OMP, or pick a model in every Sesh session.

The Mac app was built to fix that, but its controls are unconnected ([proposal 0005](0005-mac-app-ui-workspace.md)). Its Models pane and Settings file row wait for [issue #12](https://github.com/markmals/pico/issues/12): one versioned configuration contract that the app and the adapter both understand, with validated, atomic saves, app defaults kept apart from a session's own choices, and secrets kept out of ordinary files.

Mark chose the first slice of #12 on 2026-11-02: the contract and the default model. Credential references come next, in their own proposal designed with the Autonomous credential store ([#7](https://github.com/markmals/pico/issues/7)), so #12 stays open after this one. Mark also decided that once Pico has its own configuration, OMP-specific configuration must stop affecting Pico: OMP's settings files, `models.yml`, OMP extensions, and the skills, rules, prompts and commands OMP finds under `~/.omp` and a project's `.omp`. Pico's settings, Pico's fixed policy and OMP's built-in defaults decide how a Pico session behaves.

The contract the app and the adapter share is `pico`'s command line. The app is not its only client: an agent working in Sesh, including one running on Pico, may be asked which model new sessions use, or to change it. Mark asked on 2026-11-02 that Pico's commands follow agent-first command-line guidance: an agent with no prior knowledge of `pico` should be able to discover, inspect, validate, preview, run and verify each operation from the executable alone.

Mark then moved connecting the Mac app to these commands out of this proposal and into a follow-up pull request (Beads `pico-bfk.5`). This proposal changes no app code. It specifies the commands the app will use.

## Domain grounding

### Established context

- **Agent-first command-line interfaces.** Mark's guidance draws on Cloudflare's `cf` CLI ([launch](https://blog.cloudflare.com/cloudflare-cf-cli-launch/), [design](https://blog.cloudflare.com/cf-cli-local-explorer), [agent use](https://developers.cloudflare.com/cf/agents/)). Its requirements:
    - one authoritative command schema from which the parser, help, machine-readable metadata and discovery are generated, so that nothing advertised can drift from what runs;
    - discovery that needs no prior knowledge: orientation in `--help`, ranked natural-language command search, a machine-readable schema per command, and human help with examples, disclosed progressively;
    - one consistent grammar, `<resource> <operation>`, using a small set of verbs (`list`, `get`, `create`, `update`, `delete` and the like) and kebab-case names;
    - structured JSON on stdout by default, with diagnostics on stderr only;
    - errors that carry a stable code, a message, whether they are retryable, and details, with a nonzero exit status;
    - mutations that can be previewed with `--dry-run`, return a receipt, support concurrency checks and idempotent retries, and name their effective target;
    - configuration that can be validated and inspected, with missing values distinguished from defaults;
    - noninteractive execution that never hangs waiting for input;
    - discovery that works without credentials;
    - evaluation by an agent that has never seen the tool.
- **The SDK can configure a session without reading the user's files** (`@oh-my-pi/pi-coding-agent` 18.14.0):
    - `Settings.isolated(overrides)` builds settings from OMP's built-in defaults plus the overrides. It reads no global or project configuration file and never persists (`src/config/settings.ts:760-768`). Settings bound to environment variables, such as `PI_EDIT_VARIANT`, still read the process environment (`src/config/registry.ts:463-541`).
    - OMP's built-in defaults: `modelRoles` is empty, and `defaultThinkingLevel` is `high` (`src/config/model-settings.ts:109`, `src/session/settings.ts:240-244`).
    - `createAgentSession` accepts an explicit `model` and `thinkingLevel`. Without them it resolves the `default` model role from settings. With no role configured it takes `pickDefaultAvailableModel` over the models with usable credentials and reports no fallback message. With a role configured that it cannot use, it substitutes another model and says so in `modelFallbackMessage`, and Pico already fails `session/new` when that happens (`src/sdk.ts:590-615, 3440-3494`; `adapter/engine/pico-session.ts:140-145`). `pickDefaultAvailableModel` is public through the package's `./*` export (`src/config/model-resolver.ts:89`).
- **The catalog is available without a session.** `new ModelRegistry(authStorage, modelsPath, { ignoreLocalModelConfig, settings, cacheDbPath })` loads the bundled and cached catalog. `getAvailable()` filters it to models with usable credentials. `refresh("online-if-uncached")` runs discovery only for providers whose cache is cold (`src/config/model-registry.ts:537-556, 634, 3144`). `ignoreLocalModelConfig: true` skips `models.yml` entirely, but the built-in local providers stay discoverable through their environment variables: Ollama (`OLLAMA_BASE_URL`), llama.cpp (`LLAMA_CPP_BASE_URL`) and LM Studio (`LM_STUDIO_BASE_URL`) (`model-registry.ts:1044, 1657-1745`). LM Studio discovery reads an OpenAI-compatible `/v1/models` (`src/config/model-discovery.ts:459, 1104-1130`). `getSupportedEfforts(model)` gives a model's reasoning levels without a session (`@oh-my-pi/pi-catalog/src/model-thinking.ts:23`).
- **OMP-specific discovery comes from three capability providers.**
    - `native` (`src/discovery/builtin.ts:40-43`) produces every skill, rule, slash command, prompt, system prompt file, context file, hook, extension module, custom tool, settings file and MCP file under `~/.omp/agent` and a project's `.omp`.
    - `omp-plugins` produces configured extension packages.
    - `omp-managed` produces auto-learned skills.
    - The `disabledProviders` setting excludes all three, and `createAgentSession` binds it to the capability registry (`sdk.ts:1802-1806`, `src/capability/index.ts:351-443`).
    - Prompt templates are a separate scan of `~/.omp/agent/prompts` and `.omp/prompts` that only `promptTemplates: []` replaces (`src/config/prompt-templates.ts:160-178`).
    - `AGENTS.md` files (provider `agents-md`), `.agent` and `.agents` directories (`agents`) and other harnesses' directories belong to other providers.
- **Restricted sessions run no ambient extension discovery** (`sdk.ts:2770-2900`). Pico reaches user and project extensions only because `adapter/engine/session-extensions.ts` runs that discovery itself.
- **Sesh 0.29.0**, observed in its files on 2026-11-02:
    - Each session's `session.json` keeps a `preferredConfig` holding only the options the user changed. No Sesh file keeps a per-agent default.
    - A captured trace shows one `session/set_config_option` after `session/new`, and again after `session/resume`, sending that session's `preferredConfig` before the first prompt. Three `pico-dev` sessions have no `preferredConfig`, so they ran on Pico's own choice.
    - Sesh caches each agent's config options, including the current values, in `agent-probes.json`.

### Relevant constraints and principles

- **Never fall back silently.** A model, file or command that cannot be used fails with its cause.
- **Never rewrite the user's OMP configuration or credentials.** Pico reads the user's credential store in place and writes no OMP file.
- **One parser, one command schema.** Mark chose `pico` as the only reader and writer of the settings file. The app, when it is connected, and agents use the same commands, and every command's parser, help, schema and search entry come from one registry.
- **Swift gets no second provider engine** ([PROTOTYPE.md](../PROTOTYPE.md#configuration-and-credentials)). Everything the app will need to show, including the catalog, each model's thinking choices and the effective default, comes from `pico`.
- **The executable's existing contract stays** ([proposal 0002](0002-pico-homebrew-distribution.md)). With no arguments and stdin not a terminal, `pico` is the ACP agent Sesh launches. `pico --version` prints `pico <version>` and a newline. An unknown argument exits 2. The Homebrew formula's test relies on the last two.
- **A setting exists only if it changes a real capability.** The default model and reasoning level change what a new session runs on, and no other setting is added.

### Quality bar

Saving a default model with `pico settings update` changes the model the next new Sesh session starts on, without restarting anything. A session that is already open, or that was given a model in Sesh, keeps its own. A save that fails leaves the previous file byte-for-byte unchanged and says why. Nothing under `~/.omp`, other than the credential store Pico already reads, affects a Pico session. An agent that has never seen `pico` can find the right command, change the default, recover from a rejected value, and confirm the result, using only the executable.

### Remaining uncertainty

- Sesh's model picker for a new session shows the value Sesh cached when it last probed Pico. After the default changes, that value can be stale until the session starts and reports the model it actually used. The preview has to show whether Sesh sends the cached value as an explicit choice, which would override Pico's default.
- `pico` sees the environment of whatever launched it. A provider whose only credential is a shell environment variable can be available from a terminal but missing for a process that seshd or a GUI app launches.
- The fake local server for `pico:verify` and the agent evaluation has to satisfy LM Studio discovery as OMP 18.14.0 performs it. That is established from the source, not yet exercised.

## Existing baseline

The adapter's model handling is the baseline to preserve:

- A new session starts on one model, and a model OMP would substitute is a failure (`pico-session.ts:130-145`).
- `session/set_config_option` changes the model or thinking level for that session only, through `setModelTemporary` and a non-persisting `setThinkingLevel` (`pico-session.ts:176-178`).
- A reopened session takes its model and level from its own journal, and fails when that model is no longer available ([proposal 0004](0004-session-restoration.md)).

Those rules stay. What changes is where the starting choice comes from.

`loadPicoSettings` (`adapter/engine/pico-settings.ts`) loads the user's settings read-only and overlays Pico's policy. The policy keys stay. Clearing the user's per-tool approval policies was needed only because user settings were loaded, and it goes away with them.

Several pieces exist only to serve OMP configuration and go with it:

- `session-extensions.ts` and its tests, which run user and project OMP extensions.
- The Bun patch from proposal 0004, which threads the user's original configuration directory through native discovery. Once native discovery is disabled, Pico needs that directory only to open the credential store.
- The test provider in `adapter/engine/testing/test-provider.ts`, `writeMockProviderKey`, and `pico:verify`'s mock provider (`adapter/smoke/verify.ts:36-100`). All of them supply a model through a project `.omp/extensions` file plus `.omp/config.yml`, or through `models.yml`, so they need another route.

`adapter/invocation.ts` recognizes only `--version` and bare ACP invocation, printing `usage: pico [--version]` to stderr for anything else. `adapter/pico.ts` handles `--version` before loading OMP. That ordering is the pattern for discovery commands: `pico` can answer them without the native addon, OMP or credentials.

The Mac app is unchanged by this proposal. Its sample data already holds the rule a default-model change needs: keep the reasoning level when the new model offers it, otherwise switch to that model's default level (`app/Sample/SampleSettings.swift:69-75`). `settings update` adopts that rule, so the connected app will not need its own copy.

## Proposed solution

`pico` owns one JSON file, `~/Library/Application Support/Pico/settings.json`. It carries a version number and, for now, one setting: the default model and its reasoning level. `pico` gains a small command tree, `models list`, `models get`, `settings get` and `settings update`, and the discovery commands an unfamiliar agent needs: `--help`, `cli search` and `schema`. All of them come from one command registry. Results are JSON on stdout, errors are coded JSON on stderr, and `settings update` can be previewed, guarded by a revision, and read back.

Each `session/new` reads the file. A model chosen in Sesh still wins for that session, and a reopened session keeps its own. Pico sessions stop reading OMP's settings files, `models.yml`, extensions and OMP-only prompt sources.

```text
pico cli search "change the default model"  → settings update ranked first, with its usage
pico schema settings update                   → its options, accepted values, effects, output schema and error codes
pico settings update --default-model anthropic/claude-sonnet-5-5 --dry-run
                                              → receipt with before and after, dryRun true, nothing written
pico settings update --default-model anthropic/claude-sonnet-5-5
                                              → receipt with the new revision
pico settings get                             → the saved default, and that new sessions start on it
pico settings update --default-thinking max   → exit 2, INVALID_ARGUMENT listing the levels the model offers
```

## Detailed design

### Concepts

- **Pico settings:** the document in `settings.json`. It holds only non-secret settings. It belongs to the user's Pico installation, not to a project or a session.
- **Default model:** a model and a thinking level saved together in Pico settings. They decide what a new session starts on. The model value is the `provider/id` string Pico's Model option sends Sesh. The thinking value is one of the values Pico's Thinking option offers for that model.
- **Effective default:** what a new session would start on now. That is the saved default when one is saved; otherwise it is OMP's built-in choice.
- **Session choice:** a model or thinking level set on one session through `session/set_config_option`. It belongs to that session and its journal, never to Pico settings.
- **Catalog:** the models a new Pico session can use, in the order Pico's Model option lists them. It is OMP's bundled and discovered catalog, filtered to models with usable credentials, without `models.yml`. With OMP configuration no longer read, it does not depend on the project.
- **Revision:** an identifier of the settings file's exact bytes: `sha256:` followed by the lowercase hex SHA-256 of the file, or `none` when there is no file.
- **Command registry:** the single declaration of every `pico` command. The parser, help, schema output and search index are generated from it.

### The settings file

- The settings file's path is `<data directory>/settings.json`, which is `~/Library/Application Support/Pico/settings.json` for the user running `pico`. It does not exist until the first save.
- Version 1 is a JSON object with these members:

    ```json
    {
        "version": 1,
        "defaultModel": "anthropic/claude-sonnet-5-5",
        "defaultThinking": "high"
    }
    ```

    - `version` is required and is the integer `1`.
    - `defaultModel` and `defaultThinking` are non-empty strings that are either both present or both absent.

- Reading the file yields one of four states:
    - **Missing:** there is no file.
    - **Valid:** the shape above, with or without the default.
    - **Unsupported:** an object whose `version` is an integer greater than 1. Its problem says that a newer Pico wrote it.
    - **Invalid:** anything else, such as a file that is not UTF-8 JSON, is not an object, lacks `version`, has a member of the wrong type, has only one of the pair, or has a member the version does not define. Its problem names the JSON path of the first thing wrong.
- Reading checks only the file's shape. Whether the saved model can be used is checked when a session starts and when a change is saved.
- Only `pico settings update` writes the file. After validating, a write:
    1. creates the data directory with mode `0700` if it is missing;
    2. writes the complete document to a temporary file in the same directory, as JSON indented by four spaces with a trailing newline;
    3. flushes it to disk and renames it over `settings.json`;
    4. removes the temporary file if any step fails.
- A failed save of any kind leaves the previous file exactly as it was, or absent. A reader always sees a complete document. A revision check protects against a stale read, not against two writers that both pass it at the same moment; between those, the last rename wins.
- Pico never overwrites a file it cannot read: an unsupported or invalid file must be fixed or removed first.
- The file holds no secret and nothing but the members above.

### What a Pico session reads

- Every Pico session, new or reopened, uses `Settings.isolated` with Pico's existing policy overrides (eval, LSP, delegation depth, approval mode, restricted folders, `todo` and title refresh). It takes nothing from the user's global or project OMP settings, and every other setting keeps OMP's built-in default. Settings, credentials and local-provider endpoints that OMP reads from environment variables still come from the environment `pico` was launched with.
- The model registry uses the bundled catalog, discovery for providers with usable credentials and for OMP's built-in local providers, and its cache in Pico's `models.db`. It ignores `models.yml`.
- Pico disables the `native`, `omp-plugins` and `omp-managed` discovery providers and passes no prompt templates. A Pico session therefore loads none of these from `~/.omp/agent` or a project's `.omp`: skills, rules, slash commands, prompts, prompt templates, system prompt files, context files, hooks, extensions or custom tools. It loads no auto-learned skills either. `AGENTS.md` files, `.agent` and `.agents` directories, and other harnesses' directories load as before.
- Pico no longer discovers or loads OMP extensions. Its own write-bridge extension is unchanged. Tests whose subject is loading OMP extensions, or extensions rewriting tool calls, are deleted with that support.
- Pico still opens the user's OMP credential store in place, from the user's original OMP configuration directory. That is now the only thing the directory is used for.
- Remove the proposal 0004 SDK patch and the code that threads the original configuration directory through discovery.
- In-process tests supply their mock provider through `createPicoSession`'s caller, as they already supply a credential store, instead of writing `.omp` files.
- Sesh-supplied MCP servers, the tool roster and its checks, the write bridge, restoration and stdout isolation are unchanged.

### Starting a session

- `session/new` reads `settings.json` each time, so a save applies to the next new session without restarting `pico`. The catalog is resolved as for the CLI below, including one cache-aware discovery pass when the saved model is not in the cached catalog.
    - **Valid with a default model:** the session starts on that model at that thinking level, and its config options report both. If the model is not in the catalog, or the model does not offer that thinking value, `session/new` fails. The error names the saved model and says to choose another default with `pico settings update`. No session is created and no model is substituted.
    - **Missing, or valid without a default:** the session starts on OMP's built-in choice, `pickDefaultAvailableModel` over the catalog, at that model's default thinking level. Mark noted that Sesh makes the user pick a model before a session starts, and Sesh learns its choices from Pico's `session/new` response, so failing here would leave Sesh nothing to offer. If no model has usable credentials, `session/new` fails as it does today.
    - **Unsupported or invalid:** `session/new` fails with the file's problem and path. No session is created.
- `session/set_config_option` is unchanged. It changes that session alone and is never written to Pico settings.
- `session/load` and `session/resume` do not read `settings.json`. A reopened session starts on its journal's model and thinking level, as [proposal 0004](0004-session-restoration.md) specifies, whatever the default is now. An invalid settings file does not stop a session from reopening.
- A Sesh child session that Pico starts is a new session like any other.

### Thinking choices for a model

- A model's thinking choices are the options Pico's Thinking option offers for it. A model with reasoning offers Off, then Auto, then its supported reasoning levels in OMP's order. A model without reasoning offers only Off, because no other level changes anything for it; Mark decided this on 2026-11-02 after the adversarial review found that `pico` could save Auto for such a model while its session reported Off. This changes proposal 0001's Thinking option for those models, which also listed Auto. The config option and the CLI share one pure function of a model, so Sesh and every `pico` client see the same list.
- A model's default thinking level is the value Pico's Thinking option shows when a session starts on that model with no level chosen. That is Off for a model without reasoning; otherwise it is OMP's built-in `high`, adjusted to the nearest level the model supports, as OMP adjusts it.

### The `pico` command line

#### Command tree

| Invocation | Effects | Purpose |
| --- | --- | --- |
| `pico` | ACP session | The ACP agent Sesh launches, unchanged |
| `pico --version` | none | `pico <version>`, unchanged |
| `pico --help` | none | Orientation |
| `pico <command> --help` | none | Human usage and examples for one command |
| `pico schema [<command>]` | none | Machine-readable command index, or one command's specification |
| `pico cli search <query>` | none | Ranked commands for a task described in words |
| `pico models list [--provider <provider>]` | reads | The catalog |
| `pico models get <model>` | reads | One catalog model and its thinking choices |
| `pico settings get` | reads | Pico settings, their status and revision, and the effective default |
| `pico settings update [--default-model <model>] [--default-thinking <level>] [--if-revision <revision>] [--dry-run]` | writes | Change the default model or thinking level |

- Commands follow `pico <resource> <operation>`, with the operations `list`, `get` and `update`. Resource names are plural for collections (`models`) and singular for the one settings document (`settings`). `schema` and `cli search` are the discovery verbs. Command and option names are kebab-case, option names match the JSON fields they set, and no command or option has an alias.
- No command prompts, reads stdin, opens a browser or waits for input. A missing required value is an error, and so is an option given twice: `INVALID_ARGUMENT` names it rather than letting the last one win silently (Mark, 2026-11-02).
- A `models` or `settings` command loads OMP, opens the credential store read-only as sessions do, and runs at most one cache-aware catalog refresh, `online-if-uncached`, so a cold cache is filled once and a warm one makes no request. Discovery commands, `--help` and `--version` load no OMP module and no native addon. They open no credential store, create no data directory, and make no network request.

#### The command registry

- `adapter/cli/` holds one declarative registry. For each command it declares:
    - its path, summary, description and search keywords;
    - its positional arguments and options, each with type, required flag, default, accepted values, and how to find them;
    - its effects (`none`, `reads` or `writes`), whether it supports `--dry-run`, and whether it is idempotent;
    - its output schema;
    - the error codes it can return, each with its exit status and retryability, and when it occurs;
    - examples;
    - its handler.
- Schemas are declared once with zod (`zod/v4` from `zod` 3.25.76, already installed as the ACP SDK's peer dependency, added as an exact-pinned direct dependency). One declaration gives runtime validation, TypeScript types, and the JSON Schema that `pico schema` prints. The settings file is parsed with its own zod schema.
- The argument parser, `--help` text, `schema` output and `cli search` index are generated from the registry. No command, option, default or error appears anywhere else.

#### Discovery

- **`pico --help`** prints to stdout and exits 0. Its text, generated from the registry, covers:
    - one paragraph on what `pico` is, saying that run with no arguments it is the ACP agent Sesh launches;
    - the command tree, each command with its summary;
    - how to discover the rest: `pico cli search "<task>"`, `pico schema <command>`, `pico <command> --help`, and `--dry-run` before `settings update`.
- **`pico <command> --help`** prints to stdout the command's usage line, description, arguments and options with their types, defaults and accepted values, its effects, whether it supports `--dry-run`, its error codes and its examples, then exits 0. `--help` anywhere after a command path prints that command's help and runs nothing.
- **`pico schema`** prints the index: `{ "apiVersion": 1, "version": "<package version>", "commands": [{ "command": "settings update", "summary": "…", "effects": "writes" }, …] }`.
- **`pico schema <command>`**, given the command's words, prints its specification: `command`, `summary`, `description`, `usage`, `arguments`, `options`, `effects`, `dryRun`, `idempotent`, `output` (JSON Schema), `errors` (each `code`, `exitCode`, `retryable`, `when`) and `examples`. An unknown command is `NOT_FOUND`, and its details list the known commands.
- **`pico cli search <query>`** joins its arguments into one query and returns `{ "apiVersion": 1, "query": "…", "items": [{ "command", "summary", "usage" }] }`. The list holds at most five commands, ranked by how many distinct query words match the start of a word in each command's path, summary, description, keywords and option names. Case and diacritics are ignored, as are a fixed list of filler words such as "a", "the" and "to". Ties go to registry order. A query matching nothing returns an empty list with exit status 0.

#### Output contract

- On success, stdout carries exactly one JSON document and a newline, and the exit status is 0. The document is indented by two spaces when stdout is a terminal and compact otherwise. Stdout is isolated as it is for the agent, so nothing else reaches it.
- Every JSON document `pico` prints, result or error, includes `"apiVersion": 1`. A change to any result or error shape that could break a client raises it.
- A `list` result holds its collection in `items`, and a `get` result holds its resource in `item`. Context, meaning the settings file or the credential store a result came from, is a top-level field. Lists are never paginated or truncated: the catalog is local and bounded, and every list is complete.
- Diagnostics go to stderr.

#### Errors

- On failure, stdout is empty. The last line of stderr is the error document, compact on one line, written after any diagnostics:

    ```json
    {
        "apiVersion": 1,
        "error": { "code": "NOT_FOUND", "message": "…", "retryable": false, "details": {} }
    }
    ```

- Exit status 2 means `INVALID_ARGUMENT`, and 1 means any other error, as in the table below.

| Code | Exit | Retryable | When |
| --- | --- | --- | --- |
| `INVALID_ARGUMENT` | 2 | no | An unknown command or option, a missing or malformed value, `settings update` with neither `--default-model` nor `--default-thinking`, or a thinking level the model does not offer. `details` names the `argument`, and lists `accepted` values when they are known. |
| `NOT_FOUND` | 1 | no | A model that is not in the catalog, because it is unknown or has no usable credentials, or an unknown command given to `schema`. `details` names it and the command that lists the alternatives. |
| `FAILED_PRECONDITION` | 1 | no | The settings file is unsupported or invalid, so it cannot be updated, or `--default-thinking` is given with no saved default model. `details` carries the `settingsFile` and `problem`. |
| `CONFLICT` | 1 | yes | `--if-revision` does not match the file. `details` carries `expected` and `actual`. Retry after reading the settings again. |
| `UNAVAILABLE` | 1 | when busy | The credential store cannot be opened. Retryable only when the store reports that it is busy or locked. `details` carries the store's path and the cause. |
| `IO_ERROR` | 1 | no | Reading or writing the settings file failed. `details` carries the path and the operating system's cause. |
| `INTERNAL` | 1 | no | Anything else, with its message. |

- An unknown argument therefore still exits 2, as proposal 0002 requires. Bare `pico` with stdin a terminal prints the `--help` text to stderr, then a line saying that Sesh launches `pico` as an ACP agent, and exits 2. No error code is involved, because no command was given.

#### Commands

- **`pico models list [--provider <provider>]`** returns `{ "apiVersion": 1, "credentialStore": "<path>", "items": [Model] }`. `--provider` keeps the models whose provider is exactly that id; one that matches nothing gives an empty list. A model is:

    ```json
    {
        "value": "anthropic/claude-sonnet-5-5",
        "name": "Claude Sonnet 5.5",
        "provider": "anthropic",
        "thinking": [
            { "value": "off", "name": "Off" },
            { "value": "auto", "name": "Auto" },
            { "value": "high", "name": "high" }
        ],
        "defaultThinking": "high"
    }
    ```

    `value`, `name` and `thinking` are exactly what Pico's Model and Thinking options send Sesh for that model.

- **`pico models get <model>`** returns `{ "apiVersion": 1, "credentialStore": "<path>", "item": Model }`, or `NOT_FOUND`.
- **`pico settings get`** returns:

    ```json
    {
        "apiVersion": 1,
        "settingsFile": "/Users/mark/Library/Application Support/Pico/settings.json",
        "status": "valid",
        "revision": "sha256:…",
        "item": { "defaultModel": "anthropic/claude-sonnet-5-5", "defaultThinking": "high" },
        "effective": {
            "defaultModel": "anthropic/claude-sonnet-5-5",
            "defaultThinking": "high",
            "source": "settings",
            "available": true
        }
    }
    ```

    - `status` is `missing`, `valid`, `unsupported` or `invalid`. The last two carry `problem`, and their `item` and `effective` are `null`.
    - With `missing`, or `valid` with nothing saved, `item` holds two `null` values, so a value that is not set is distinguishable from a default.
    - `effective` is what a new session would start on now. Its `source` is `settings` when a default is saved, and then `available` says whether `session/new` could use it. Otherwise `source` is `built-in` and the values are OMP's built-in choice, or `null` with `available` false when no model has usable credentials.
    - The command validates the file and the saved default without changing anything, so it is also the configuration check.

- **`pico settings update`** changes the default:
    - Options:
        - `--default-model <model>` sets the model. Without `--default-thinking`, the saved thinking level is kept when the new model offers it, and otherwise replaced by the model's default thinking level.
        - `--default-thinking <level>` sets the level for the given model, or for the saved model when none is given.
        - At least one of the two is required.
        - `--if-revision <revision>` refuses the update with `CONFLICT` unless the file's current revision matches. `none` means the file must not exist.
        - `--dry-run` does everything except write.
    - Order of checks:
        1. parse the arguments;
        2. read the file, refusing if it is unsupported or invalid;
        3. check the revision;
        4. resolve the catalog and validate the model and level;
        5. compute the new document;
        6. write it, unless it is unchanged or this is a dry run.
    - It returns a receipt:

        ```json
        {
            "apiVersion": 1,
            "settingsFile": "/Users/mark/Library/Application Support/Pico/settings.json",
            "dryRun": false,
            "changed": true,
            "before": {
                "revision": "none",
                "item": { "defaultModel": null, "defaultThinking": null }
            },
            "after": {
                "revision": "sha256:…",
                "item": { "defaultModel": "anthropic/claude-sonnet-5-5", "defaultThinking": "high" }
            }
        }
        ```

    - An update that would not change the file is idempotent: `changed` is false, `after` equals `before`, and nothing is written.
    - A dry run returns `dryRun: true`. Its `after.revision` is the revision the write would produce, and the file is untouched.
    - `settings get` reads the result back, and `before` holds what an update back would restore.
    - The update replaces a default rather than destroying data, so it asks for no confirmation and has no force option.
    - No command removes a saved default, because Mark chose that a model must be chosen. Deleting `settings.json` is the only way back to OMP's built-in choice.

#### Guidance that does not apply

- **Authentication, profiles and tokens.** No command signs in or holds a credential. Commands read the existing store, and credentials are the next slice of #12.
- **Pagination, field projection and streaming.** Every list is a complete local catalog. `--provider` narrows it, and `jq` can project fields.
- **Environments and remote targets.** There is one settings file per macOS user, and every result names it.
- **Long-running operations.** Every command finishes before it exits. A client can still impose its own timeout.
- **Structured request bodies.** The inputs are two scalar options.
- **Documentation search, an agent skill and an MCP surface.** `pico` ships no documentation beyond its help and schema. The registry is where any of these would be generated from later.
- **Text and table output modes.** JSON is the only result format, and `--help` is the human form.

### Tests, guides and verification

- Write each test to fail first.
- Bun tests cover the settings file and its saves:
    - reading each file state, including a lone `defaultModel`, an unknown member and a newer version;
    - writing the expected bytes and revision;
    - every refused or failed update leaving the previous bytes unchanged, or no file.
- Bun tests cover the command line:
    - every registry option is accepted and an undeclared one rejected, and every registry example parses to its command;
    - `--help`, `schema` and `cli search` are generated for every command;
    - representative searches rank their commands first: "change the default model" finds `settings update`, "which models can I use" finds `models list`, and "what model do new sessions start with" finds `settings get`;
    - every command's actual output validates against its declared schema, and every error a handler returns is declared for it, with its exit status;
    - discovery commands succeed with an unwritable home, no credentials and no network, and create nothing;
    - `settings update`:
        - a dry run writes nothing and reports the revision a write produces;
        - `--if-revision` conflicts with a changed file and with `none` when a file exists;
        - an unchanged update is idempotent;
        - a model given alone keeps a supported level and replaces an unsupported one;
        - `--default-thinking` alone requires a saved default.
- Bun tests cover sessions:
    - `session/new` starting on the saved default, failing on an unusable default and on an invalid file, and starting on the built-in choice with no default;
    - `settings get`'s `effective` naming the model that `session/new` then starts on, with and without a saved default;
    - a later update applying to the next `session/new` on the same connection;
    - `session/set_config_option` overriding the default for one session;
    - a reopened session keeping its own model, including when the settings file is invalid;
    - isolation: in a scratch OMP configuration directory and project, a `config.yml`, project settings, `models.yml`, extensions, skills, rules, prompts, commands and an `.omp/AGENTS.md` each would change a session, and none does. The project's `AGENTS.md` and `.agents/skills` still load.
- `pico:verify` changes how its compiled `pico` gets an offline model. It starts a local fake OpenAI-compatible server that OMP's built-in LM Studio provider discovers through `LM_STUDIO_BASE_URL`, with no extension or OMP configuration file. In its scratch home it then runs:
    - `--help`, `schema` and `cli search`;
    - `settings get` with no file;
    - a `settings update` dry run, then the update, then `settings get`;
    - a session that starts on the default;
    - a refused update, confirming the file is unchanged.
- **Agent evaluation:** before handoff, a fresh agent with no knowledge of Pico gets `.build/pico`, a scratch home and the fake server, and five tasks:
    1. find which models it can use;
    2. preview making one of them the default;
    3. make it the default at a level the model supports;
    4. attempt a level the model does not offer, and recover;
    5. report what new sessions start on.

    Record each task's end state (`settings.json` and `settings get`, not exit statuses), the commands run, invalid commands, recoveries, and whether the agent verified its result. Fix any discovery or error defect it exposes within this design, and include the record in the readiness report.

- Revise `guides/running-pico-in-sesh.md` from this proposal before changing code. It should say what Pico reads and no longer reads, how the default applies, and which `pico` commands exist, pointing to `pico --help` rather than reproducing the reference.

- Revise `AGENTS.md` (including its layout and commands), `PROTOTYPE.md`, `README.md` and `VISION.md` wherever they describe Pico applying its policy over the user's OMP configuration, or `pico` accepting only `--version`. Where they say the app's configuration waits for #12's contract, say that the contract now exists and that connecting the app is the follow-up. Add a changeset.
- Run `mise run check` and `mise run pico:verify`, then exercise the preview.

## Compatibility

- **Pico sessions lose everything they took from OMP's configuration files**, while terminal OMP is unaffected. That covers:
    - OMP's default model and thinking level, and project model settings;
    - every other OMP setting, including compaction, retries, provider options, enabled models and auth account-pool policy;
    - custom models and providers in `models.yml`;
    - user and project extensions and hooks;
    - OMP's skills, rules, prompts, commands, system prompt files and `.omp/AGENTS.md`.
- **No migration.** Pico does not import OMP's default model, because Mark chose that a model must be chosen. Until one is, new sessions start on OMP's built-in choice, and Sesh and `pico settings get` show which model that is.
- **Existing sessions** reopen on their own journal's model. A session whose model came from `models.yml` fails to reopen with proposal 0004's unavailable-model error.
- **`pico`** keeps its ACP invocation, its `--version` output and exit status 2 for an unknown argument, so the Homebrew formula's test still passes. Usage errors now end stderr with an `INVALID_ARGUMENT` document instead of `usage: pico [--version]`. Bare `pico` on a terminal prints the orientation help.
- **The settings file** is new, so nothing reads an older version.
- **Dependencies:** `zod` becomes a direct, exact-pinned dependency at the version already installed.

## Implications on adoption

Users who want a particular starting model choose it once with `pico settings update`, or in the app once the follow-up connects it. Nothing is installed, registered or signed differently. Removing `settings.json` returns new sessions to OMP's built-in choice. Reverting this change restores reading OMP's configuration and leaves the settings file in place, ignored.

## Scope

- The versioned settings file, its validation and atomic, revision-checked saves.
- The `pico` command line: the registry, discovery commands, `models list`, `models get`, `settings get` and `settings update`, the output and error contracts, and the invocation changes.
- New sessions starting on the saved default, with session choices and reopened sessions unchanged.
- Pico sessions no longer reading OMP's settings files, `models.yml`, extensions and hooks, or OMP-only skills, rules, prompts and commands. This includes removing the code, tests and SDK patch that served only them, and moving test providers to the in-process seam and the fake local server.
- Tests, `pico:verify`, the agent evaluation, guides, contract, brief, README and vision wording, and a changeset.

### Out of scope

- **The Mac app.** Connecting the Models pane and the Settings file row to these commands, how the app finds and runs `pico`, and removing the app's sample-data mode belong to a follow-up pull request (Beads `pico-bfk.5`). That pull request completes the app half of prototype criterion 15. The app's controls stay unconnected until then.
- **Credentials.** Credential references, Pico-managed secrets, the Keychain, sign-in and the Providers & Accounts pane belong to the next slice of #12, designed with #7 (Beads `pico-bfk.4`). This slice stores no secret and reads credentials exactly as today.
- **Other settings.** No other OMP setting becomes a Pico setting, and there are no per-project defaults.
- **Live changes.** Changing the default never changes a running or reopened session.
- **Environment variables.** Pico does not clear OMP settings set in the environment it was launched with.
- **Runtime readiness and versions, `intellisense`, Sesh registration and diagnostics.** These rows stay unconnected.
- **The guidance listed as not applying above**, including documentation search, an agent skill and an MCP surface.
- **Bundling `pico` in the app, distributing the app, signing and notarization.**

## Preview

- Repository shape: a CLI executable carrying the ACP adapter.
- Artifact: `.build/pico`, used from a terminal and by an agent, and a real Sesh session driven by the registered development launcher, `.build/pico-acp`, which runs this checkout's adapter. The commands and the session behavior are the two surfaces this proposal changes.

- Access: the local checkout. Nothing is published, installed over Homebrew's `pico`, or registered differently in Sesh.
- Exercise:
    - Run `.build/pico --help`, `cli search`, `schema settings update`, `models list` and `settings get`.
    - Save a default with `.build/pico settings update`, first with `--dry-run`. Read it back with `settings get`.
    - Run `settings update --if-revision` with a stale revision and see `CONFLICT`.
    - Start a new Sesh session. It starts on the chosen model and level, and a prompt is answered by it. Observe what Sesh's picker shows before the session starts.
    - In an older session, choose a different model in Sesh, close it, reopen it, and confirm it keeps that model.
    - Make a save fail, for example by making the data directory read-only. Confirm the error, and that `settings.json` is unchanged.
    - Confirm that a `config.yml` default model and a user extension no longer affect a new session.
    - Read the agent evaluation record.
- Completion cleanup: restore any permission changed for the failed save, stop the fake server, and leave `settings.json` holding the human's choice. No account or registration needs cleanup.

## Policies and decisions checked

- Formal policy records: None. `policies/` contains only its index.
- Formal decision records: None. `decisions/` contains only its index.
- [VISION.md](../VISION.md): configuration is native and truthful, and settings exist only when backed by real capabilities. This proposal keeps both. Its description of the app as configuring nothing stays true until the follow-up connects it.
- [PROTOTYPE.md](../PROTOTYPE.md):
    - Its Configuration runtime decision and its [Configuration and credentials](../PROTOTYPE.md#configuration-and-credentials) section apply Pico's policy "over the user's normal OMP configuration". Mark's decision replaces that with Pico's settings and fixed policy over OMP's built-in defaults, reusing only credentials.
    - Its "dedicated local process channel" for the app becomes the `pico` command line.
    - The brief is revised to match.
- `AGENTS.md`:
    - The hard rule "Apply Pico's policy per process and per session over the user's normal configuration" is revised the same way. Never rewriting the user's OMP configuration or credentials still holds.
    - Its "no build-tool wrappers" rule is unaffected, because `pico`'s commands are product behavior.
- [Proposal 0001](0001-acp-adapter-core.md): its `session/new` rules for starting on the model the user's OMP configuration resolves, keeping user and project extension hooks working, and reading the user's OMP settings read-only are replaced by this proposal's. Its rule that Pico substitutes no model is kept.
- [Proposal 0002](0002-pico-homebrew-distribution.md): the ACP invocation, `--version` output, exit status 2 for unknown arguments and the formula test are kept. The usage line it specifies is replaced by the `--help` text and the `INVALID_ARGUMENT` document. Its "later subcommands" clause anticipated exactly this.
- [Proposal 0004](0004-session-restoration.md): restoration is unchanged. Its SDK patch, and the threading of the original configuration directory into discovery, are removed. The directory is still used for the credential store.
- [Proposal 0005](0005-mac-app-ui-workspace.md): unchanged. The follow-up connects its Models pane and Settings file row through these commands, and removes its sample-data mode at Mark's direction.
- [Proposal 0006](0006-todo-plan-updates.md): its pinned `todo` and title overrides stay. `todo.eager` and `todo.remindersMax` now take OMP's built-in defaults instead of the user's.

## Future directions

- Credential references and Pico-managed secrets, through this file and these commands, designed with #7.
- Further Pico settings, such as the `intellisense` location, each when it changes a real capability, each added to the registry.
- An agent skill, documentation search or an MCP surface generated from the registry, if agents need more than `--help`, `schema` and `cli search`.
- A live change to running sessions, if Sesh gains a way to show one.

## Alternatives considered

- **The app parses and writes the file itself.** That means two parsers and two validators to keep in step. Mark chose `pico` as the only reader and writer.
- **One combined helper report** (the first draft's `pico settings`). It was simpler for the app, but an agent could not discover it, and every call returned the whole catalog. Mark asked for agent-first commands, which split it into resources an agent can find and read separately.
- **Hand-written help, JSON Schema and parser.** Three descriptions of each command would drift. The registry generates all of them.
- **Text output by default, with `--json`.** Agents would add the flag on every call. JSON is the result format, and `--help` is the human form.
- **No command search for a small command tree.** `schema` alone would list the commands. Search costs a pure function over the registry, and it lets an agent go from a task in words to a command without reading the whole tree.
- **Confirmation for `settings update`.** It replaces a default that the receipt records and another update restores, so confirmation would add friction without protecting anything.
- **Pico's default sitting under a project's OMP model setting.** Mark decided that no OMP-specific setting should affect Pico.
- **A way to clear the default and return to OMP's choice.** Mark chose that a model must be chosen.
- **Failing `session/new` when no default is saved.** Sesh learns which models it can offer from that response, so failing would leave the user unable to pick one in Sesh.
- **Falling back to OMP's choice when the saved default cannot be used.** That would silently start a model the user did not choose.
- **A long-lived JSON-RPC helper.** Nothing in this slice streams or needs cancellation. A process per command is simpler and cannot outlive its caller.
- **Storing settings in the app's user defaults.** The adapter could not read them without a second format, and the brief places Pico's settings in Application Support.

## Open questions

None.
