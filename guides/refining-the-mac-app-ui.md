---
id: guide.refining-the-mac-app-ui
title: Refining the Mac App UI
describes: [proposal.0005]
---

# Refining the Mac App UI

## What it does

Pico's Mac app is a native UI scaffold for refining the settings window before connecting it to real configuration. Its sidebar opens General, Providers & Accounts, Models, Tools & Integrations, Sesh, and Diagnostics & About. Each pane has a grouped layout; settings controls remain unavailable and values say “Not connected.”

Only window management, navigation, and scrolling work. The app does not inspect or change your Pico or OMP configuration, read credentials, discover models, launch a helper, or contact Sesh. Configuration functionality waits for issue #12's shared contract and subsequent integration work.

## How to use it

Use a Mac running macOS 27 with full Xcode selected and this checkout's pinned mise/Tuist tools installed. This is an unsigned local development build, not a Homebrew app release.

```sh
mise run macos:run
```

The task generates the Xcode workspace, builds this checkout's app, and opens `.build/macos/Build/Products/Debug/Pico.app`. No provider account, installed adapter, settings file, or Sesh registration is required. After the first build, you can also open that app directly in Finder.

1. Start on General and choose another sidebar destination. Its title and selected row change together.
2. Inspect the grouped rows and disabled controls. “UI scaffold — configuration not connected” identifies the boundary; none of the configuration controls can save, authenticate, or perform a simulated operation.
3. Scroll a pane, visit another destination, then return. Its scroll position is retained while this app process runs.
4. Choose Pico > Settings or press Command-Comma. The same window comes forward; no second settings window opens.
5. Resize the window and inspect Light and Dark appearances, keyboard navigation, and accessibility. It initially opens at 920 by 680 points. It cannot become narrower than 760 points, and its content keeps at least 520 points of height below the toolbar; with the standard macOS 27 toolbar that makes the smallest window 572 points tall.

Closing the window quits the app. Reopening starts at General. There is no saved selection, setting, or cross-launch restoration contract.

## Worked example

Run `mise run macos:run`, select Models, and inspect the model and reasoning rows. Their controls are unconnected; there is no model catalog to search or choice to apply. Switch to Sesh to inspect its setup layout, then press Command-Comma: Sesh remains selected in the existing window. No model, credential, or Sesh registration has changed.

## Build and formatting commands

```sh
mise run macos:build
mise run macos:fmt
mise run macos:lint
mise run check
```

`macos:build` compiles the Debug app without opening it. `macos:fmt` and `macos:lint` cover both the manifests and app sources. The repository gate builds the app on macOS and retains its Bun-only gate on other hosts. There is no native test target for placeholder labels or static wiring; the running app is the layout/navigation check.

## Limits and edge cases

- Settings are deliberately unavailable. Runtime readiness, installed versions, configuration location, account state, and connection state are not loaded; “Not connected” is not a diagnosis of your installation.
- No sample accounts, fabricated model catalogs, working filters, editable demonstration settings, or simulated workflows are included.
- Issue #12 is not required to inspect the scaffold. It is required before configuration functionality can be connected; it does not by itself implement provider sign-in or Sesh setup.
- The app keeps `me.malstrom.pico` as its bundle identifier. The run task opens the exact app in this checkout, not an installed copy.
- The local app is unsigned and has not been prepared for distribution. It is not installed over another app, and no signing, notarization, or quarantine workaround is performed by these tasks.
- There is no bundled engine or runtime in the app. Quitting it does not stop an existing adapter or Sesh session.
