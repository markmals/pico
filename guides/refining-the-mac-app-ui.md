---
id: guide.refining-the-mac-app-ui
title: Refining the Mac App UI
describes: [proposal.0005]
---

# Refining the Mac App UI

## What it does

Pico's Mac app is a native settings window, laid out like macOS System Settings, for refining the design before it is connected to real configuration. Its sidebar opens General, Providers & Accounts, Models, Tools & Integrations, Sesh, and Diagnostics & About. Each pane starts with a header and lists its settings in grouped rows. Every configuration control is unavailable, and every value reads “Not connected”, until you turn on sample data to see the panes in their working state.

Navigation works: the sidebar, back and forward, search across every setting, and `pico://` links. The app does not inspect or change your Pico or OMP configuration, read credentials, discover models, launch a helper, or contact Sesh, with or without sample data. Configuration functionality waits for issue #12's shared contract and subsequent integration work.

## How to use it

Use a Mac running macOS 27 with full Xcode selected and this checkout's pinned mise/Tuist tools installed. This is an unsigned local development build, not a Homebrew app release.

```sh
mise run macos:run
```

The task generates the Xcode workspace, builds this checkout's app, and opens `.build/macos/Build/Products/Debug/Pico.app`. No provider account, installed adapter, settings file, or Sesh registration is required. After the first build, you can also open that app directly in Finder.

### The window

Pico opens on General. The window is 715 points wide and does not change width; drag its top or bottom edge to change its height. The sidebar always shows: there is no button, menu command, or divider for hiding or resizing it.

The sidebar lists the panes in four groups. Choose one to open it; the pane's title appears in the toolbar. “UI scaffold — configuration not connected” at the bottom of every pane marks the boundary: none of the controls can save, sign in, or perform a simulated operation.

Each pane keeps its scroll position while the app runs, including when you return to it with back or forward. Choose Pico > Settings or press Command-Comma to bring the same window forward. Closing the window quits the app; reopening starts at General with no history.

### Back and forward

The toolbar's back and forward buttons work like a browser's. View > Back (⌘[) and View > Forward (⌘]) do the same.

- Opening a different page adds the page you left to the back history and clears the forward history. A page is a pane, or a provider's page inside Providers & Accounts. Choosing the pane you are already on in the sidebar changes nothing, even from a provider's page.
- Back returns to the previous page; forward undoes back.
- When a provider's page goes away, because you removed the provider or turned sample data off, the history forgets it, and if you were on it you return to the page before it.
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

Pane names in links are `general`, `providers`, `models`, `tools`, `sesh`, and `diagnostics`. The setting names for each pane are listed in [proposal 0005](../proposals/0005-mac-app-ui-workspace.md#deep-links); a setting keeps its link name even if its label changes. A provider's page has no link.

### Sample data

Choose View > Show Sample Data to see every pane filled in as if Pico were set up. Choose it again to return to the unconnected panes. Sample data is off whenever Pico starts; to start with it on, for a screenshot or a script, quit Pico and launch it with an argument:

```sh
mise run macos:run -- --args -ShowsSampleData YES
```

While it is on, the notice at the bottom of every pane reads “Sample data — nothing here is saved or connected”. Every value is invented. The panes have the same rows as without sample data, now with values, and the pickers, the catalog search field, and these buttons work:

- **General:** the Runtime checklist shows `pico` installed at `/opt/homebrew/bin/pico`, starting, and up to date. Versions lists the Pico app, `pico`, and the OMP version that `pico` is built on; Pico and OMP have their own version numbers. Show in Finder, on the Settings file row, opens Pico's folder in Application Support if it exists; right-click the row and choose Copy Path to copy the path.
- **Providers & Accounts:** the list shows Anthropic signed in with a Claude account, OpenAI with an API key, Google needing sign-in, and OpenRouter not set up. Choose a set-up provider to open its page; ⌘[ or the back button returns to the list. The page shows what the provider requires, then an Account row with how it is signed in. The ⋯ button at the end of that row lists the provider's ways to sign in, such as Sign In With a Claude Account… or Provide an Anthropic API Key…, and Sign Out…; choosing one takes effect at once, with no sign-in window. Below the row, the provider's privacy policy and terms are links to its real pages, which open in your browser; the terms link opens the provider's page of legal terms, because which terms apply depends on how you sign in. Remove Provider, the red button under the Account group, takes the provider off the list. Set Up, on OpenRouter, and Add Provider…, which offers xAI, Mistral, and Groq, add a provider that needs sign-in and open its page.
- **Models:** the default-model picker offers only signed-in providers' models, and the reasoning-level picker offers only the levels the chosen model supports. Choosing a model that doesn't support the current level switches to that model's default level. The catalog lists every sample model and marks models of providers that aren't signed in as unavailable; type in Search catalog to filter it by model or provider name. If you sign out or remove the provider of the default model, the default moves to the first model still available; with every provider signed out, the default model reads “None available”.
- **Sesh:** Unregister and Register switch between a registered, connected Pico and an unregistered one.
- **Tools & Integrations and Diagnostics & About:** sample paths, versions, and statuses to read; nothing to change.

Your choices stay while Pico runs, even if you turn sample data off and on, and are gone when it quits. Nothing is written to disk, the Keychain, or your defaults, and nothing contacts a provider, Sesh, or another app; the only things that leave the window are the path Copy Path puts on the clipboard, the Finder window Show in Finder opens, and the provider policy pages the links open. Search, back and forward, and links work the same with sample data on; search matches setting names, never sample values, and an account or credential term such as “API key” finds the Providers list.

## Worked example

Run `mise run macos:run`, then type `thinking` in the sidebar search. Choose “Reasoning level”: Models opens with the Reasoning level row outlined. Its picker is unavailable; there is no model catalog or choice to apply. Clear the search and choose Sesh, then press ⌘[: Models returns, scrolled where you left it.

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

`macos:build` compiles the Debug app without opening it. `macos:test` runs the native tests for navigation history, search, and links. `macos:fmt` and `macos:lint` cover the manifests, app sources, and tests. On macOS, the repository gate builds the app and runs the native tests; other hosts keep the Bun-only gate.

## Limits and edge cases

- Settings are deliberately unavailable. Runtime readiness, installed versions, configuration location, account state, and connection state are not loaded; “Not connected” is not a diagnosis of your installation.
- Search covers pane and setting names and their alternative terms, not setting values or explanatory text. There is no keyboard shortcut for the search field.
- History and search do not survive quitting Pico.
- Without sample data, the Models pane's “Search catalog” field is a disabled placeholder; there is no model catalog to filter.
- Sample data shows a plausible working state, not what Pico will support: the real engine may offer other providers, credential sources, models, and reasoning levels. Sample accounts use `example.com` addresses.
- Issue #12 is not required to use the scaffold. It is required before configuration functionality can be connected; it does not by itself implement provider sign-in or Sesh setup.
- Links only work once macOS knows about a built copy of the app, which happens when it is first launched or opened. If another app also claims `pico://`, macOS chooses which one opens.
- The app keeps `me.malstrom.pico` as its bundle identifier. The run task opens the exact app in this checkout, not an installed copy.
- The local app is unsigned and has not been prepared for distribution. It is not installed over another app, and no signing, notarization, or quarantine workaround is performed by these tasks.
- There is no bundled engine or runtime in the app. Quitting it does not stop an existing adapter or Sesh session.
