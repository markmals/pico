---
id: guide.refining-the-mac-app-ui
title: Refining the Mac App UI
describes: [proposal.0005, proposal.0007]
---

# Refining the Mac App UI

## What it does

Pico's Mac app is a native settings window with General, Providers & Accounts, Models, Tools & Integrations, Sesh, and Diagnostics & About. Models reads the real Pico catalog and saves the default model and reasoning level for new sessions. General checks runtime readiness, offers confirmed Homebrew recovery actions, and shows the actual settings file location. Other configuration controls remain unavailable and read “Not connected”.

The app reads and changes configuration through `pico`'s commands, not by opening the settings document itself. Provider sign-in and credential management still use [Pico's commands](running-pico-in-sesh.md); Providers & Accounts is not connected yet. The app does not change OMP configuration or register an agent in Sesh. Sample-data mode has been removed.

## How to use it

Use a Mac running macOS 27 with full Xcode selected and this checkout's pinned mise/Tuist tools installed. This is an unsigned local development build, not a Homebrew app release.

```sh
mise run macos:run
```

The task builds this checkout's `pico` executable and app, then opens `.build/macos/Build/Products/Debug/Pico.app` with that executable selected. This uses your real Pico configuration. When opened directly in Finder, the app looks for an executable at `/opt/homebrew/bin/pico`, then `/usr/local/bin/pico`; install it through Homebrew if neither exists. For a different executable, launch the app with `-PicoExecutable <absolute-path>`. This override is a launch argument, not a saved preference.

### The window

Pico opens on General. The window is 715 points wide and does not change width; drag its top or bottom edge to change its height. The sidebar always shows: there is no button, menu command, or divider for hiding or resizing it.

The sidebar lists the panes in four groups. Choose one to open it; the pane's title appears in the toolbar. “Some settings aren't connected yet” appears below every pane except Models. Versions, provider accounts, integrations, and Sesh registration remain unconnected.

Each pane keeps its scroll position while the app runs, including when you return to it with back or forward. Choose Pico > Settings or press Command-Comma to bring the same window forward. Closing the window quits the app; reopening starts at General with no history.

### Runtime readiness

General checks the local `pico` command when the window opens and when you return to General. Installed shows the executable's location or explains why it could not be found. Starts runs `pico schema` and checks its command API and version response. This does not test provider authentication, model availability, or a Sesh turn. Retry repeats the local checks. If both standard Homebrew installations exist, checks and package actions use the one that owns the resolved Pico command.

Up to date begins as Not checked. Choose Check for Updates to refresh Homebrew's metadata, re-read the local command, and compare it with `markmals/tap/pico`. A failed check shows its cause instead of reporting that Pico is current. A newer development command is distinguished from the published version. An executable selected with `-PicoExecutable` is not assumed to be the Homebrew installation.

When recovery is available, General offers Install, Reinstall, or Update. Each action requires confirmation, runs Homebrew without a terminal or administrator prompt, and then checks the actual installation again. A successful package command alone is not proof that Pico starts. Package operations disable automatic cleanup of old versions; Pico does not stop Sesh sessions. Reinstall is refused when Pico observes the command running. Stop those sessions before confirming a reinstall, and do not start another until it finishes.

If Homebrew has Pico installed but its command link is missing, the checklist offers Reinstall to restore the installation rather than repeating an install that Homebrew would skip. The reinstall check also looks for running Pico executables in unlinked kegs.

If Homebrew is missing or older than version 6, Open Homebrew Installer opens its official graphical installer download page. Complete that installer, then return to Pico and retry. If Homebrew requires trust for `markmals/tap`, Pico offers a separate confirmation before trusting the tap; checking readiness does not grant trust. A first install is blocked until that approval is supplied rather than letting Homebrew grant formula trust implicitly. Homebrew permission, network, or package failures remain visible in General.

### Back and forward

The toolbar's back and forward buttons work like a browser's. View > Back (⌘[) and View > Forward (⌘]) do the same.

- Opening a different pane adds the pane you left to the back history and clears the forward history. Choosing the pane you are already on changes nothing.
- Back returns to the previous pane; forward undoes back.
- A button and its menu command are unavailable when there is nothing to go back or forward to.

### Search

Type in the search field at the top of the sidebar. The pane list is replaced by results: matching panes and settings, each with its pane's icon and, for a setting, the pane's name beneath it. The pane you are looking at does not change while you type.

A result matches when every word you type starts a word in its name. Case and accents are ignored. Some settings also match common alternative terms, such as “thinking” for Reasoning level or “terminal” for Shell. When nothing matches, the sidebar shows “No Results”.

Choose a result with the mouse or the arrow keys. Pico opens its pane, scrolls to the setting, and outlines its row; VoiceOver moves to that row. The outline stays until you navigate elsewhere. Your search stays in place so you can choose another result. Clear the field, or press Escape, to return to the pane list.

### Links

Every pane and setting has a link:

| Link | Opens |
| --- | --- |
| `pico://settings` | Pico, without changing the pane |
| `pico://settings/models` | the Models pane |
| `pico://settings/models/reasoning-level` | Models, scrolled to Reasoning level with its row outlined |

Open a link from Terminal with `open`, from a browser, or from another app. If Pico is not running, the link launches it. A link Pico does not recognize shows an alert naming the link and leaves the window where it was.

Pane names in links are `general`, `providers`, `models`, `tools`, `sesh`, and `diagnostics`. The setting names for each pane are listed in [proposal 0005](../proposals/0005-mac-app-ui-workspace.md#deep-links); a setting keeps its link name even if its label changes.

### Model defaults

Pico loads settings and the available model catalog when the window opens and whenever you return to Models. A reload requested while changes are saving waits for those changes to finish. While loading, both pickers are disabled. The catalog comes from `pico`, using the provider credentials selected in Pico; it is not a list of invented or assumed models.

Choose a model or reasoning level and the selection changes immediately. Both pickers stay usable while Pico saves changes in the background, in the order you made them. The picker shows model names without provider suffixes; Available Models retains each model's `provider/id` for reference. The reasoning picker offers only that model's supported levels, with readable labels such as Extra High and Maximum. When you change models, the app previews the retained level or the new model's catalog default; `pico` makes the authoritative choice when saving. The footer indicates when changes are still saving.

With no saved default and an available catalog, the pickers read “Not Set”; with an empty catalog, the model picker reads “None available”. If `pico` reports a built-in starting model, the footer names it; choosing a model replaces that implicit default with an explicit choice. If no automatic default is available, choose a model before starting a session without a model override. There is no option to clear a saved default. Available Models lists the catalog in its supplied order, with each model's `provider/id` and a Default marker on the saved choice.

Once settings load, an attention badge marks Models in the sidebar if no default model has been chosen. The badge follows your selection immediately and returns if the first model save fails. A loading or failed read does not count as a missing default.

A saved model that is no longer available remains visible as unavailable; Pico does not silently replace it. Choose another model before starting a new session. With no available models, connect and select a provider credential using Pico's commands, then return to Models.

Pico uses these defaults for new sessions without a model override from Sesh. Sessions already open, and sessions with their own model choice in Sesh, keep their choices.

### Settings file

General's Settings file row displays the location returned by `pico`. Show in Finder selects the file when it exists, or opens its containing folder when only that folder exists. It is disabled if neither exists. Right-click the row and choose Copy Path to copy a displayed path.

The location loads independently of the model catalog. A catalog failure leaves the path and its file actions usable; Models shows the catalog error with Try Again. If the settings command itself fails, General shows its cause and Try Again instead of an unexplained unavailable value.

### Built-in tool policy

Tools & Integrations lists Read, Search (`grep` and `glob`), Edit, Write, Shell (`bash`), Web search, Task list (`todo`), and Wait. Task list updates appear as Sesh's plan; Wait waits for background shell jobs. Search for `todo` or `plan` to find Task list, and `wait` or `background jobs` to find Wait.

These are fixed policy, not editable toggles. Eval, built-in LSP, and native OMP delegation remain excluded. Sesh supplies additional tools for each session.

### Recovering from errors

If settings change outside the window before a save completes, Pico refuses the stale save, discards changes still waiting to be saved, reloads, and tells you what happened. Review the current values before choosing again. Other save failures show their cause and roll back the failed choice without erasing newer choices you made while it was saving. A reasoning-level choice stays tied to the model you were editing.

A failed load makes the model controls unavailable and shows its cause with Try Again. An invalid or unsupported settings file instead shows the reported problem and asks you to fix or remove the file, with Show in Finder when the location exists. Pico does not overwrite the broken document. A missing executable, incompatible command API, or command that exceeds 30 seconds is reported rather than treated as an empty catalog.

## Worked example

Run `mise run macos:run`, then type `thinking` in the sidebar search. Choose “Reasoning level”: Models opens with the Reasoning level row outlined. With a saved, available model, it offers that model's supported levels; otherwise the pane explains what is missing. Clear the search and choose Sesh, then press ⌘[: Models returns and reloads its values.

From Terminal:

```sh
open pico://settings/tools/shell
```

Pico comes forward on Tools & Integrations with the Shell row outlined. No model, credential, or Sesh registration has changed.

## Build, test, and formatting commands

```sh
mise run macos:build
mise run macos:test
mise run macos:fmt
mise run macos:lint
mise run check
```

`macos:build` compiles the Debug app without opening it. `macos:test` runs the native tests for command handling, configuration state, navigation history, search, and links. `macos:fmt` and `macos:lint` cover the manifests, app sources, and tests. On macOS, the repository gate builds the app and runs the native tests; other hosts keep the Bun-only gate.

## Limits and edge cases

- “Not connected” on the remaining scaffold rows is not a diagnosis of your installation.
- Search covers pane and setting names and their alternative terms, not setting values or explanatory text. There is no keyboard shortcut for the search field.
- History and search do not survive quitting Pico.
- Model availability follows Pico's selected credentials. The app does not sign in, select credentials, or recover inaccessible Keychain items on your behalf.
- The app inherits its launch environment, which can differ from your terminal's environment for local model servers.
- Provider/account UI and Sesh setup remain separate work.
- Links only work once macOS knows about a built copy of the app, which happens when it is first launched or opened. If another app also claims `pico://`, macOS chooses which one opens.
- The app keeps `me.malstrom.pico` as its bundle identifier. The run task opens the exact app in this checkout, not an installed copy.
- The local app is unsigned and has not been prepared for distribution. It is not installed over another app, and no signing, notarization, or quarantine workaround is performed by these tasks.
- There is no bundled engine or runtime in the app. Quitting it does not stop an existing adapter or Sesh session.
