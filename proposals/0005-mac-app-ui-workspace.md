---
id: proposal.0005
title: Mac App UI Workspace
authors: [Mark Malstrom]
status: active-review
pull-request: https://github.com/markmals/pico/pull/41
issues: [https://github.com/markmals/pico/issues/18]
supersedes: []
---

# Mac App UI Workspace

## Summary

Scaffold the existing Pico target's native macOS 27 window, navigation, and settings-pane layouts so they behave like System Settings: fixed sidebar, back/forward history, app-icon tiles, sidebar search across every setting, and `pico://` deep links. Configuration controls remain unconnected until issue #12; this proposal adds no configuration behavior or demonstration model.

## Motivation

Pico's native target has project metadata but no sources or window. Generating the Xcode workspace cannot answer whether its navigation, forms, sizing, or typography work in a real Mac app. Mark needs a runnable UI to iterate on before implementing the configuration contract and connecting it to the adapter.

[Issue #18](https://github.com/markmals/pico/issues/18) originally combines that workspace with a General pane backed by real runtime and configuration data. This proposal covers only its UI scaffolding. Mark selected the existing Pico target and macOS 27, and explicitly deferred settings functionality until [#12](https://github.com/markmals/pico/issues/12) is implemented. The scaffold can proceed before #12; connecting its controls cannot.

Mark returned the first implementation from review on 2026-11-01 with System Settings parity changes: no collapsible sidebar, a toolbar with back/forward navigation, app-icon-shaped sidebar icons, and a fixed-width window. Mark also asked for System Settings search: search every settings item, show the results in the sidebar, and take the user to the setting when a result is chosen. Each setting is also addressable from outside the app through a `pico://` URL. These are working navigation behaviors, not configuration behaviors; they need no data from #12.

## Domain grounding

### Established context

- Apple's [Window documentation](https://developer.apple.com/documentation/swiftui/window) defines a single, unique window that can be the app's primary scene. Opening its identifier again brings the existing window forward. With a single primary `Window`, closing it quits the app by default.
- Apple's [SwiftUI navigation guidance](https://developer.apple.com/videos/play/wwdc2022/10054/) combines `NavigationSplitView`, a sidebar `List`, and explicit selection for native multicolumn navigation. Selection and navigation state are distinct from the content being inspected.
- Apple's [grouped form style](https://developer.apple.com/documentation/swiftui/formstyle/grouped) provides grouped rows with leading labels and trailing controls. Its [sidebar guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars) favors familiar symbols, descriptive labels, discoverable navigation, and respecting the system accent color.
- Apple's [settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings) establishes the App menu's Settings command, Command-Comma, and a title reflecting the visible pane. Its conventional toolbar-based preferences layout is not this project's chosen composition: the brief explicitly chooses the System Settings sidebar layout.
- Mark's System Settings references (macOS 27, supplied 2026-11-01) are the visual authority for this revision. The window has a fixed-width, non-collapsible sidebar with a search field above grouped destinations, each with a colored rounded-square icon. The toolbar holds a joined back/forward control followed by the pane title. A typed query replaces the sidebar with results; each result shows its pane's icon, the setting name, and the pane name beneath it. The detail pane keeps its current content until a result is chosen.
- Apple's [SwiftUI `onOpenURL`](<https://developer.apple.com/documentation/swiftui/view/onopenurl(perform:)>) delivers URLs routed to the app by Launch Services from the app's declared `CFBundleURLTypes`, including at launch.

### Relevant constraints and principles

The visual authority is macOS System Settings: native sidebar selection, a titled detail pane, grouped forms, SF Symbols, and system typography and materials. This is a local desktop utility, not a web dashboard, quota monitor, menu-bar app, or second conversation UI.

A pane stub is a visual layout, not a configured setting, authenticated account, installed engine, or observed readiness state. A navigation destination does not advertise an adapter capability. Unconnected controls must look unavailable rather than imply that Pico can save or apply them. Search, history, and deep links navigate to and reveal stubbed settings; they never change, load, or validate a setting.

### Quality bar

The workspace launches as an actual app with six pane layouts and working navigation, history, search, deep links, and scrolling. It supports visual refinement of hierarchy, spacing, sizing, typography, and native controls. Settings remain visibly unconnected; no demonstration behavior or data-loading layer is needed.

### Remaining uncertainty

Exact spacing, symbol choices, tile colors, and window height are refined against the running app during implementation and human preview. Mark's references fix the composition, not exact point values. #12 determines the later configuration contract. This proposal does not predesign that contract or assume provider, credential, runtime, or Sesh APIs. Another app on a Mac could also claim the `pico` URL scheme; Launch Services then chooses one handler.

## Existing baseline

`Project.swift` defines a source-free macOS app target named `Pico`, bundle identifier `me.malstrom.pico`, Swift 6, complete strict concurrency, and `ExistentialAny`. Its actual deployment floor is macOS 27, despite macOS 14 statements in the brief and agent contract. Signing is disabled, and no App Sandbox integration is configured. Preserve these project settings; align the stale floor documentation with Mark's macOS 27 choice.

`Config/Version.xcconfig` projects the package version into the app build settings. Preserve that ownership instead of hand-editing `MARKETING_VERSION` or creating a second app version source.

The existing `macos:generate`, `macos:open`, formatting, and `macos:check` tasks validate project configuration. There are no app sources, native test targets, build task, or launch task. `mise run check` invokes the native configuration check on macOS and preserves the Bun gate on other hosts.

The native-app section of [PROTOTYPE.md](../PROTOTYPE.md#native-macos-configuration-app) supplies the visual reference and six destinations. Its ban on unconnected panes and the contract's source-free-until-functional rule currently exclude the requested UI stage. They need a narrow, explicit revision on implementation, not a silent interpretation that these screens configure Pico.

## Proposed solution

Use the existing Pico app target for one native settings-style window with six sidebar destinations and grouped pane layouts. Configuration rows and controls are static, visibly unconnected stubs. Window management, navigation history, search, deep links, and scrolling work. Do not create a separate prototype target, mock configuration service, or interactive demonstration model.

```text
Type "reasoning" in the sidebar search → choose "Reasoning level — Models" → Models opens, scrolled to the highlighted row
Press the back button (⌘[) → the previous pane returns at its previous scroll position
open pico://settings/tools/shell → Pico comes forward on Tools & Integrations with the Shell row highlighted
```

The deliverable is the UI scaffold, not a functional configuration app. It must be runnable for visual iteration, but it need not simulate the functionality that will be added later.

## Detailed design

### Stub boundary

The shared window displays a concise notice equivalent to “UI scaffold — configuration not connected.” Configuration controls remain disabled or display an explicit unconnected value. Any control shown for layout must make its unavailable state clear to both sighted users and accessibility clients.

Do not add editable demonstration settings, populated sample accounts or model catalogs, a working model-catalog search or filter, simulated authentication, fake progress, or successful-looking save/apply results. Use neutral placeholders such as “Not connected” rather than inventing a configured value. A picker or the model-catalog search field can be present as a disabled layout stub. The sidebar search in [Search](#search) is navigation, not a catalog filter.

The app performs no configuration read/write, persistence, credential access, provider request, runtime discovery, helper launch, diagnostic collection, or Sesh operation. Version, runtime-status, and configuration-location rows are also unconnected UI; this slice does not load their real values.

Do not define a configuration schema, backend protocol, mock service, or future integration abstraction to support these stubs. #12 remains the prerequisite for adding configuration functionality; its completion does not itself imply that every provider or Sesh workflow has been implemented.

### Concepts

- **Destination:** one of the six panes. Its identity is a fixed lowercase slug, independent of its localized title.
- **Settings item:** one labelled row in exactly one destination. Its identity is its destination slug plus its own slug. The same fact shown in two panes (the app version under General and under Diagnostics & About) is two items, because the item is a placement.
- **Settings location:** a destination or a settings item. A search result, a deep link, and a history entry all name a location, so the app uses one type rather than separate result, link, and history models.
- **Navigation history:** the sequence of destinations the user has navigated between. Revealing a different item on the same destination is not a history entry.
- **Revealed item:** the single item the latest navigation pointed at. It is transient and is replaced or cleared by the next navigation.

The settings items are the single source of each row's label: pane views render their rows from the items, and search reads the same items. Do not keep a second list of labels for search.

### Window and navigation

The app uses a single primary SwiftUI `Window` scene, with AppKit only where a required native interaction cannot be expressed through SwiftUI. Launch opens General. The App menu's Settings command and Command-Comma bring this same window forward rather than making a second settings window. Retain the single-window scene's normal close-to-quit behavior; reopening the app starts a fresh UI session with empty history.

The window has a fixed width of 715 points, a 680-point default height, and resizes vertically only. The content below the toolbar keeps at least 520 points of height. A two-column `NavigationSplitView` holds a fixed 215-point sidebar and the selected detail pane. The sidebar cannot be hidden or resized: there is no sidebar toggle in the toolbar, no Show/Hide Sidebar command, and no draggable column divider. Human visual refinement may adjust these point values.

The sidebar has a search field at its top, then the destinations in four groups separated by space, without group headers:

| Group | Destinations, in order       |
| ----- | ---------------------------- |
| 1     | General                      |
| 2     | Providers & Accounts, Models |
| 3     | Tools & Integrations, Sesh   |
| 4     | Diagnostics & About          |

Each sidebar row shows the destination's app-icon tile and title, with a visible selected state. An app-icon tile is a continuous-corner rounded square filled with the destination's fixed color and a white SF Symbol glyph, as in System Settings. Each destination has its own color, and the glyph stays legible in Light, Dark, and Increase Contrast. Tiles do not follow the accent color; selection does.

The toolbar's leading navigation area holds a joined back/forward control, followed by the active destination's title. No other toolbar items are added. No onboarding window, status menu, dashboard, or chat view is introduced.

Navigation history follows browser rules:

- Navigating to a destination other than the current one pushes the current destination onto the back history and clears the forward history. Navigating to the current destination changes no history.
- Back moves to the most recent back entry and pushes the current destination onto the forward history. Forward is the mirror operation.
- Back and forward are disabled when their history is empty. The View menu has Back (⌘[) and Forward (⌘]) commands with the same availability.
- Choosing a sidebar row, a search result, or a deep link is a navigation. Back and forward themselves do not clear the forward history.

Use stable destination and item identities rather than labels or list indices. Selection and each pane's scroll position survive navigation within the current process, including back and forward. There are no editable setting values to retain. No cross-launch restoration or settings persistence is required.

### Search

Typing a query into the sidebar search field replaces the destination list with search results; clearing the field (including with Escape) restores the destination list with the current destination selected. Typing does not change the detail pane.

Matching uses the localized strings the user sees. The query is split on whitespace. A destination matches when every query word is a prefix of a word in its title. A settings item matches when every query word is a prefix of a word in its title or its search keywords. Comparison ignores case, diacritics, and character width; words are split at anything that is not a letter or digit. A query that is empty after trimming whitespace is not a search.

Items may carry a few localized keywords for terms users are likely to type instead of the label, such as “thinking” and “effort” for Reasoning level or “bash” and “terminal” for Shell. Keywords name what the setting is about; they must not name providers, models, or capabilities Pico does not support.

Results are listed in sidebar order: each matching destination, then its matching items in the order they appear in its pane. Each result row shows the destination's tile, the result title (wrapping onto further lines rather than truncating), and, for an item, its destination's title in secondary text beneath. When nothing matches, the sidebar shows “No Results”.

Choosing a result (click, or arrow keys over the list) opens its location. The search query and results stay in place, as in System Settings.

### Opening a location

Opening a destination navigates to it. Opening a settings item navigates to its destination, scrolls the item into view, and reveals it with a highlight around its row. The highlight stays until the next navigation of any kind; it is drawn as a shape, not by color alone, and VoiceOver focus moves to the revealed row. With Reduce Motion on, the scroll is not animated.

### Deep links

The app declares the `pico` URL scheme. A link opens a settings location:

| Link                                   | Opens                                        |
| -------------------------------------- | -------------------------------------------- |
| `pico://settings`                      | brings the window forward without navigating |
| `pico://settings/<destination>`        | that destination                             |
| `pico://settings/<destination>/<item>` | that item, revealed as above                 |

The scheme and host are case-insensitive; destination and item slugs are matched exactly, in lowercase. One trailing slash is allowed. A link with any other host, an unknown destination, an item that is not in the named destination, extra path components, a query, or a fragment is invalid. An invalid link brings the window forward and shows an alert naming the link and saying Pico cannot open it; the current pane and history are unchanged. A link that arrives while Pico is not running launches it and then opens the location.

Destination slugs: `general`, `providers`, `models`, `tools`, `sesh`, `diagnostics`. Item slugs:

| Destination | Item slugs (title) |
| --- | --- |
| `general` | `runtime-status` (Runtime status), `engine-status` (Engine status), `app-version` (Pico app), `engine-version` (Engine), `settings-file` (Settings file) |
| `providers` | `provider` (Provider), `connection-status` (Connection status), `account` (Account), `credential-source` (Credential source), `credential-status` (Credential status) |
| `models` | `model` (Model), `reasoning-level` (Reasoning level), `catalog-search` (Search catalog), `available-models` (Available models) |
| `tools` | `read` (Read), `search` (Search), `edit` (Edit), `write` (Write), `shell` (Shell), `web-search` (Web search), `eval` (Eval), `built-in-lsp` (Built-in LSP), `native-delegation` (Native delegation), `intellisense-location` (intellisense location) |
| `sesh` | `helper-location` (Helper location), `launch-arguments` (Launch arguments), `custom-agent` (Sesh custom agent), `connection-status` (Connection status), `setup-status` (Setup status) |
| `diagnostics` | `app-version` (App version), `engine-version` (Engine version), `recent-errors` (Recent errors), `diagnostic-report` (Diagnostic report) |

Slugs are a public contract once shipped: renaming a title does not change its slug. Pico does not register the scheme anywhere except its own `Info.plist`, and it does not change which app handles another scheme.

### Pane stubs

Every pane begins with a header group like System Settings: the destination's app-icon tile at a larger size, its title, and a one-sentence description of what the pane is for. Below it, panes use system text styles, grouped forms, standard controls, and explanatory copy adjacent to the relevant rows. The same row and section conventions recur across panes; do not introduce a generic schema-driven form renderer or a custom design system for six screens.

| Destination | UI stub |
| --- | --- |
| General | Grouped runtime, app/engine version, and configuration-location rows with unconnected values. No readiness checks or location selection. |
| Providers & Accounts | Provider/account section layout and disabled account/credential-source controls. No sample accounts, credential entry, sign-in flow, or provider discovery. |
| Models | Model and reasoning-selection layout with disabled controls. A catalog area with a disabled “Search catalog” field may be laid out, but it contains no fabricated catalog or working filter. |
| Tools & Integrations | Curated-policy explanation and unconnected integration-detail rows, including the eventual external `intellisense` location control. No executable selection or validation. |
| Sesh | Grouped launch-details and connection/setup layout with unconnected values and disabled actions. No registration or connection inspection. |
| Diagnostics & About | App-identity, version, and diagnostic-section layout. Version and diagnostic values are unconnected; no sample diagnostic results or collection/export behavior. |

These are visual structures for refinement, not full workflow implementations. Do not add setup sheets, authentication screens, sample-data systems, loading/error state machines, or recovery flows to make the scaffold appear functional.

Light and Dark appearances follow the system, as do accent color, Increase Contrast, and Reduce Motion. Navigation, search, results, and scrolling work from the keyboard. VoiceOver announces destination labels, selected state, row labels, search results with their destination, the back/forward controls and their availability, and the unavailable status of stubbed controls. Color or an icon alone cannot convey that a control is unconnected or revealed.

### Workspace and task integration

Put app sources under `app/`, grouped by app entry/navigation, search and deep links, and pane. Point `Project.swift` at those sources and declare the `pico` URL scheme in the target's `Info.plist`; never edit the generated project. The entry point launches the actual navigable scaffold rather than an empty view.

Add the following mise tasks with the code that makes them real:

| Proposed task | Required result |
| --- | --- |
| `macos:build` | Generate through Tuist and compile the actual Debug app with `xcodebuild`, using `.build/macos` as the derived-data location. |
| `macos:run` | Build and open this checkout's `.build/macos/Build/Products/Debug/Pico.app`, not an older installed copy. |
| `macos:test` | Build and run the native test target with `xcodebuild test` into the same derived-data location. |

Expand `macos:fmt` and `macos:lint` to include app and test sources. Extend `macos:check` from manifest inspection to building the app and running `macos:test`, retaining its non-macOS skip and the existing `mise run check` entry point. Do not add a package script block, second formatter, shell/Python wrapper, or placeholder release task.

History, search matching, and deep-link parsing are behavior, so they get a Swift Testing target, `PicoTests`, whose files sit beside the code they test as `*Tests.swift` and are excluded from the app target. Write each test to fail before its implementation. Cover the history rules above, including truncation and no-op navigation; search matching, keywords, normalization, ordering, and the empty query; that every item is found by each word of its own title; that every location round-trips through its link; and that each invalid-link form is rejected. Do not test static labels, placeholder values, tile colors, or view construction.

### Implementation evidence and documentation

Revise the UI-workspace guide from this proposal before changing app code. Explain how to build, run, and inspect the scaffold; how history, search, and deep links behave; and that settings stay unconnected until #12 and the subsequent integration work. There is no configuration-persistence, real-runtime, or simulated-settings acceptance scenario in this slice.

After implementation, run `mise run check`. Launch with `mise run macos:run` and exercise the actual window: visit every pane from the sidebar; use back and forward from the toolbar and with ⌘[ and ⌘]; search for an item and a destination, choose results, and clear the search; open valid and invalid `pico://` links while Pico is running and while it is not; scroll away and back; use Command-Comma; resize the height and confirm the width and sidebar stay fixed and the sidebar cannot be hidden. Inspect Light/Dark, keyboard navigation, VoiceOver, Increase Contrast, and Reduce Motion. Confirm that configuration controls remain unconnected and cannot perform or simulate external actions. Record the exercised surface and any platform limitation rather than treating project generation or passing tests as visual proof.

Update the source-free descriptions, native command documentation, and macOS floor in the relevant existing repository documents. Revise the brief and agent contract narrowly to allow these explicit UI stubs before configuration functionality, retaining the prohibition on fake operational success. Update #18's description to distinguish this UI delivery from its original integration expectations and preserve #12 as the dependency for adding configuration functionality.

## Compatibility

The ACP adapter, Homebrew executable, credentials, Sesh registrations, and existing sessions are unchanged. No configuration contract, storage migration, credential reuse, or compatibility bridge is introduced. The app keeps `me.malstrom.pico` and the manifest's macOS 27 floor; this proposal does not promise macOS 14 support.

No placeholder value becomes a saved preference or a default for later integration. Future settings behavior uses #12's contract rather than turning layout stubs into a second configuration model. Item slugs become the stable addresses later integrations and links use; connecting a setting keeps its slug.

## Implications on adoption

This is a local developer build for UI review, not a Homebrew cask or a downloadable release. It requires a macOS 27 development host and an Xcode toolchain supporting the current manifest, plus the repository's existing mise/Tuist setup. It needs no provider account, running adapter, installed helper, configuration file, or Sesh registration. Launch Services learns the `pico` scheme when the built app is first launched or opened; the scheme stops resolving once no copy of the app remains.

The prototype remains unsigned under the current project settings. No Developer ID, notarization, installation into `/Applications`, quarantine workaround, publishing, or Sesh access is part of adoption. Closing the app leaves the user's real settings and sessions untouched.

## Scope

- A runnable UI-only application in the existing Pico target, with single-window lifecycle, a fixed-width window and sidebar, and System Settings-style navigation.
- Six settings-pane stubs with pane headers, static layouts, and visibly unconnected configuration controls.
- Back/forward navigation history, sidebar search over every settings item, revealing a chosen item, and `pico://` deep links.
- Native build/run/test tasks, a Swift Testing target for the navigation behavior, formatting/build checks, accessibility inspection, and an exercised local app preview.
- A guide and focused revisions to the brief, contract, issue boundary, and current-state documentation; preserve macOS 27 and the existing version source.

### Out of scope

- Issue #12's configuration contract and all settings functionality: reading/writing settings, persistence, live changes, and session precedence. The scaffold can precede #12; configuration functionality waits for it.
- Runtime readiness detection, helper discovery or bundling, engine version inspection, credential access, provider authentication, real model catalogs, or operational diagnostic collection.
- Sesh setup/registration, adapter behavior, process channels, network services, and changes to the user's OMP configuration or active Sesh agent.
- Demonstration settings/state, sample accounts/catalogs, working model-catalog filters, simulated workflows, and backend abstractions.
- Searching anything other than the destination and item titles and keywords defined here, such as setting values or help text; ⌘F to focus search; cross-launch restoration of history or search; any URL scheme other than `pico`, and any link form other than the three above.
- A separate prototype target, webview, menu-bar app, custom UI framework, shipping package, signing/notarization, or release.
- Completion of #18's original real-data General pane or the full companion app described in the brief. Those integration outcomes require their own approved intent and evidence.

## Preview

- Repository shape: native macOS app built from this branch's existing Tuist target.
- Artifact: the actual local Debug `Pico.app` produced by `mise run macos:build` and opened by `mise run macos:run`. This is the cheapest realistic surface for visual refinement; screenshots can accompany it but do not replace it.
- Access: the local checkout and generated `.app`, without publication, installation over another app, or a provider/Sesh connection. The unsigned local build is not represented as distribution-ready.
- Exercise: native navigation, back/forward history, search, deep links, pane layouts, scrolling, resizing, appearance, and accessibility. Configuration controls remain visibly unconnected; no demonstration workflow is exercised.
- Completion cleanup: quit this branch's app and remove only implementation-owned temporary captures and test data. Keep normal ignored build output available for review. No external account, registration, service, or secret needs cleanup.
- Current state: the revised Debug `Pico.app` built from `e3db34d` is at `.build/macos/Build/Products/Debug/Pico.app` in the PR #41 worktree; `mise run macos:run` rebuilds and opens it from any checkout of the branch. It was exercised in the background with `open -g` and `pico://` links, and observed with `recon` screenshots and accessibility trees, without bringing Pico forward. Typing in search and the View menu's Back/Forward state while Pico is frontmost were not observed that way and are left for the human preview.

## Policies and decisions checked

- Formal policy records: None. `policies/` contains only its index.
- Formal decision records: None. `decisions/` contains only its index.
- [VISION.md](../VISION.md) keeps the companion native and leaves conversation UI in Sesh. The workspace preserves that direction but claims only UI behavior, not configured capabilities.
- [PROTOTYPE.md](../PROTOTYPE.md#native-macos-configuration-app) supplies the System Settings reference and destination vocabulary. This proposal explicitly revises its “no unconnected panes” staging restriction to permit UI stubs before #12-backed functionality; its real integration outcomes remain unfulfilled.
- The agent contract's source-free and no-placeholder-source restrictions require a matching narrow revision when this proposal is implemented. The allowed deliverable is the runnable UI scaffold with visibly unconnected controls, not fake connections or actions pretending to work.
- `Project.swift` remains the source of truth for the generated project. Mark chose macOS 27, resolving its conflict with the older floor in the prose. `Config/Version.xcconfig` remains projected from Changesets.
- [Proposal 0002](0002-pico-homebrew-distribution.md) remains the executable's install/update contract. This UI workspace changes neither the formula nor the signing and packaging prerequisites for a future app distribution.

## Future directions

After #12 is implemented, subsequent work can connect the stubbed settings through its shared configuration contract and the relevant real integrations. Visual refinement can happen before that connection. This proposal does not implement or simulate those future behaviors.

## Alternatives considered

- **Separate prototype target:** isolates the scaffold from the product target, but duplicates workspace setup and creates a later integration step. Mark selected the existing Pico target instead.
- **Wait for #12 and implement a real-data General pane first:** follows #18's original boundary and avoids an unconnected UI stage, but prevents the requested workspace and visual iteration from proceeding independently. Mark explicitly chose UI-first work.
- **Interactive demonstration app:** would add temporary settings, fixtures, filters, and simulated workflows. Mark explicitly wants UI stubs only; that behavior is unnecessary and could preempt #12's contract.
- **Collapsible, resizable sidebar and freely resizable window:** the first implementation's native defaults. Mark chose System Settings' fixed layout instead.
- **Disabled search stub, or a filter over pane names:** cheaper than searching items, but neither reaches the setting the user is looking for. Mark asked for System Settings search: results for every settings item, opening the setting when chosen.
- **In-app links only:** opening locations from search without a URL scheme. Mark chose to make every location addressable as a `pico://` link too.
- **Separate models for search results, links, and history entries:** each names the same thing, a destination or an item, so one settings location type avoids conversions between them.
- **Only an empty shell or SwiftUI previews:** cheaper to compile, but does not provide running sidebar navigation and pane layouts for visual refinement. Previews can supplement the scaffold, not replace it.

## Open questions

None. Mark returned the first implementation on 2026-11-01 with the parity changes, search behavior, fixed window width, and `pico://` links recorded above. Implementation of this revision waits for Mark to set `awaiting-implementation`. Configuration functionality remains deferred until #12.
