---
id: proposal.0005
title: Mac App UI Workspace
authors: [Mark Malstrom]
status: draft
pull-request: https://github.com/markmals/pico/pull/41
issues: [https://github.com/markmals/pico/issues/18]
supersedes: []
---

# Mac App UI Workspace

## Summary

Make the existing Pico target a runnable macOS 27 UI workspace for refining the companion app's visual design. Build the native window, sidebar, and representative pane layouts with explicitly labelled, in-memory demonstration state. Configuration, runtime inspection, authentication, and Sesh integration remain separate work.

## Motivation

Pico's native target has project metadata but no sources or window. Generating the Xcode workspace cannot answer whether its navigation, forms, sizing, or typography work in a real Mac app. Mark needs a runnable UI to iterate on before implementing the configuration contract and connecting it to the adapter.

[Issue #18](https://github.com/markmals/pico/issues/18) originally combines that workspace with a General pane backed by real runtime and configuration data, making [#12](https://github.com/markmals/pico/issues/12) a prerequisite. Mark narrowed this proposal to UI scaffolding and visual iteration, selected the existing Pico target instead of a separate prototype target, and chose to retain the manifest's macOS 27 floor. This proposal deliberately changes that delivery boundary; it does not claim to deliver #18's original integration requirements.

## Domain grounding

### Established context

- Apple's [Window documentation](https://developer.apple.com/documentation/swiftui/window) defines a single, unique window that can be the app's primary scene. Opening its identifier again brings the existing window forward. With a single primary `Window`, closing it quits the app by default.
- Apple's [SwiftUI navigation guidance](https://developer.apple.com/videos/play/wwdc2022/10054/) combines `NavigationSplitView`, a sidebar `List`, and explicit selection for native multicolumn navigation. Selection and navigation state are distinct from the content being inspected.
- Apple's [grouped form style](https://developer.apple.com/documentation/swiftui/formstyle/grouped) provides grouped rows with leading labels and trailing controls. Its [sidebar guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars) favors familiar symbols, descriptive labels, discoverable navigation, and respecting the system accent color.
- Apple's [settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings) establishes the App menu's Settings command, Command-Comma, and a title reflecting the visible pane. Its conventional toolbar-based preferences layout is not this project's chosen composition: the brief explicitly chooses the System Settings sidebar layout.

### Relevant constraints and principles

The visual authority is macOS System Settings: native sidebar selection, a titled detail pane, grouped forms, SF Symbols, and system typography and materials. This is a local desktop utility, not a web dashboard, quota monitor, menu-bar app, or second conversation UI.

A demonstration value is not a configured setting, an authenticated account, an installed engine, or an observed readiness state. The prototype must keep those concepts separate in both its UI and its implementation. A destination identifies a pane, not an adapter capability; exposing a prototype destination does not advertise that capability to Sesh.

### Quality bar

The workspace launches as an actual app, all six destinations have representative native layouts, and navigation and local control interactions work. It must be useful for evaluating hierarchy, spacing, scrolling, keyboard behavior, and appearance without suggesting that it has saved or applied anything. An empty view with a title is not the deliverable.

### Remaining uncertainty

Exact spacing, symbol choices, and control density are refined against the running app during implementation and human preview. No configuration schema, credential bridge, model catalog, or Sesh registration API is assumed or selected here. Their absence does not block this UI-only workspace.

## Existing baseline

`Project.swift` defines a source-free macOS app target named `Pico`, bundle identifier `me.malstrom.pico`, Swift 6, complete strict concurrency, and `ExistentialAny`. Its actual deployment floor is macOS 27, despite macOS 14 statements in the brief and agent contract. Signing is disabled, and no App Sandbox integration is configured. Preserve these project settings; align the stale floor documentation with Mark's macOS 27 choice.

`Config/Version.xcconfig` projects the package version into the app build settings. Preserve that ownership instead of hand-editing `MARKETING_VERSION` or creating a second app version source.

The existing `macos:generate`, `macos:open`, formatting, and `macos:check` tasks validate project configuration. There are no app sources, native test targets, build task, or launch task. `mise run check` invokes the native configuration check on macOS and preserves the Bun gate on other hosts.

The native-app section of [PROTOTYPE.md](../PROTOTYPE.md#native-macos-configuration-app) supplies the visual reference and six destinations. Its ban on unconnected panes and the contract's source-free-until-functional rule currently exclude the requested UI stage. They need a narrow, explicit revision on implementation, not a silent interpretation that these screens configure Pico.

## Proposed solution

Use the existing Pico app target for one native settings-style window with six sidebar destinations. Give each destination a concrete grouped layout using sample content and local interaction state. Keep a persistent prototype notice visible in every destination. Do not create a separate prototype app or introduce backend protocols merely to imitate a future configuration service.

```text
Launch Pico → General → navigate and edit demonstration controls → inspect the design
Quit and relaunch → fresh demonstration state; real Pico and OMP configuration unchanged
```

This is a complete UI-iteration workspace, not a completed configuration app. Its capability is the running interface; future integration proposals replace the demonstration content with real behavior.

## Detailed design

### Prototype boundary

The shared window chrome displays a concise notice equivalent to “UI prototype — changes are not saved or applied.” It remains visible when switching destinations and is exposed to accessibility clients. Sample account, model, path, and diagnostic content is also identified as example content where it could otherwise be mistaken for information about this Mac.

Controls used to explore layout and interaction can change explicitly owned, in-memory demonstration state. They must not use `AppStorage`, a preferences file, the configuration contract, Keychain, an OMP credential store, or adapter session state. All demonstration changes reset when the process exits. UI state survives navigation within that process; there is no cross-launch restoration promise in this slice.

Actions whose meaning requires a real external effect—sign in, save or apply configuration, choose a real executable, register with Sesh, inspect a runtime, or export diagnostics—are visibly unavailable with nearby explanatory text. Do not wire them to successful-looking alerts, fake progress, empty callbacks, or fabricated connection results. Do not collect real credentials.

The app performs no runtime discovery, helper launch, provider request, configuration read/write, or Sesh operation. Reading its own bundle metadata for the app version is permitted and must be distinguished from the example engine/version rows. No actual configuration pathname is inferred from the current Pico data directory.

### Window and navigation

The app uses a single primary SwiftUI `Window` scene, with AppKit only where a required native interaction cannot be expressed through SwiftUI. Launch opens General. The App menu's Settings command and Command-Comma bring this same window forward rather than making a second settings window. Retain the single-window scene's normal close-to-quit behavior; reopening the app starts a fresh UI session.

A two-column `NavigationSplitView` contains a native sidebar list and the selected detail pane. Its destinations, in order, are General, Providers & Accounts, Models, Tools & Integrations, Sesh, and Diagnostics & About. Each row has a restrained SF Symbol and a visible selected state. The detail title identifies the active destination. No additional onboarding window, status menu, dashboard, search destination, or chat view is introduced.

Use stable destination identities rather than labels or list indices for navigation state. Selection, each pane's local demonstration edits, filter text, and scroll position survive leaving a destination and returning during the current process. A pane must not borrow another pane's scroll position or lose its state because its view was recreated. Do not persist those demonstration values outside the UI process.

Start with a 920-by-680-point default window and a 760-by-520-point minimum. Use a sidebar with a 240-point ideal width and a 220-to-320-point range. These are initial visual-iteration dimensions, not fixed-size screenshots: resizing must keep controls reachable, wrap explanatory text and long sample values, and allow the detail content to scroll. Standard sidebar visibility controls remain available. Human visual refinements may adjust these dimensions without adding integration behavior.

### Representative pane layouts

Every pane uses system text styles, grouped forms or native lists where appropriate, standard controls, and explanatory copy adjacent to the relevant rows. The same row and section conventions recur across panes; do not introduce a generic schema-driven form renderer or a custom design system for six screens.

| Destination | UI material for this workspace | Truth boundary |
| --- | --- | --- |
| General | Runtime, version, and configuration-location sections with the layout needed for the eventual overview. Show the app version from its own bundle metadata. | Runtime and engine rows say they are not connected or checked in the UI prototype. The configuration-location row is not selected and does not assert that a settings file exists. |
| Providers & Accounts | A small, explicitly sample provider/account list and grouped account/credential-source detail, sufficient to inspect selection and account-row density. | Sample identities are not imported accounts. Sign-in, add-account, and disconnect operations are unavailable; no API-key or password entry accepts real secrets. |
| Models | A labelled example model list, local filtering, and demonstration model/reasoning controls to evaluate list and form composition. | The sample list is not an available-model catalog. Its choices apply only to demonstration state and define neither supported engine values nor persisted defaults. |
| Tools & Integrations | A read-only curated-policy explanation and representative integration-detail rows, including the external `intellisense` location's eventual placement. | Any example path is labelled; it is not resolved or validated. No control enables eval, a built-in LSP, or native OMP delegation. Executable selection is unavailable. |
| Sesh | Grouped launch-details and connection/setup rows that establish the layout of the eventual handoff. | Connection is explicitly not inspected. No registration, file picking, private API call, or change to the active Sesh agent occurs. |
| Diagnostics & About | App identity/version, explanatory support content, and a clearly labelled example diagnostic presentation. | No real logs, account information, readiness result, or engine version is collected. Diagnostic refresh/export operations are unavailable. |

Use enough sample content to evaluate typical rows, long labels and paths, and scrolling. Keep it local and finite; it is visual material, not a second provider integration engine or a speculative configuration schema. Do not implement authentication sheets, setup flows, catalogs, or error-recovery workflows merely to populate the layouts.

Light and Dark appearances follow the system, as do accent color, Increase Contrast, and Reduce Motion. Sidebar navigation, local controls, and scrolling work from the keyboard. VoiceOver announces destination labels, selected state, form labels, prototype scope, and why unavailable actions are unavailable. Color or an icon alone cannot distinguish sample content or convey state.

### Workspace and task integration

Put the app sources under `app/`, grouped by app entry/navigation and the pane they implement. Update `Project.swift` to include those sources and the native behavioral test targets; never edit the generated project. The app entry point must launch the complete UI described above, not an empty view that exists only to make the target compile.

Add the following mise tasks with the code that makes them real:

| Proposed task | Required result |
| --- | --- |
| `macos:build` | Generate through Tuist and compile the actual Debug app with `xcodebuild`, using `.build/macos` as the derived-data location. |
| `macos:test` | Run native behavioral tests through `xcodebuild`, including the UI navigation/state checks below. A failure remains a failed task. |
| `macos:run` | Build and open this checkout's `.build/macos/Build/Products/Debug/Pico.app`, not an older installed copy. |

Expand `macos:fmt` and `macos:lint` to include the app and native test sources. Extend `macos:check` from manifest inspection to building the real app, retaining its non-macOS skip. Keep `mise run check` as the repository gate and run `macos:test` as the additional native behavioral gate. Do not add a package script block, second formatter, shell/Python wrapper, or placeholder release task.

Use Apple's test frameworks. Permanent tests cover consumer-visible UI boundaries: navigating away and back preserves each pane's own edits/filter and scroll position; Command-Comma targets the existing window; restarting resets demonstration edits. Do not add tests that merely count sidebar rows, match prototype wording, compare fixture copies, or assert that a view can be constructed.

### Implementation evidence and documentation

Derive applicable failing behavioral tests from this design before app implementation. Write the UI-workspace guide from this proposal before the app code, explaining how to build, run, inspect, and reset it and what is deliberately unconnected. There is no configuration-persistence or real-runtime acceptance scenario in this slice.

After implementation, run `mise run check` and `mise run macos:test`. Launch with `mise run macos:run` and exercise the actual window: visit every pane, change local demonstration values, filter the sample models, scroll away and back, use Command-Comma, resize to the minimum and a larger window, and quit/relaunch to observe reset behavior. Inspect Light/Dark, keyboard navigation, VoiceOver, Increase Contrast, and Reduce Motion on the running surface. Record what was exercised and any platform or automation limitation rather than substituting a generated project or passing tests for visual proof.

Update the source-free descriptions, native command documentation, and macOS floor in the relevant existing repository documents. Revise the brief and agent contract to permit this explicitly labelled UI-only stage in the Pico target while retaining the prohibition on fake operational success. Record that real configuration, account, runtime, and Sesh behavior is not implemented. Update #18's scope/dependency description to distinguish this UI delivery from its original integration expectations; do not close the integration requirements as satisfied by sample content.

## Compatibility

The ACP adapter, Homebrew executable, credentials, Sesh registrations, and existing sessions are unchanged. No configuration contract, storage migration, credential reuse, or compatibility bridge is introduced. The app keeps `me.malstrom.pico` and the manifest's macOS 27 floor; this proposal does not promise macOS 14 support.

Demonstration choices are deliberately not migration input for future real settings. Connecting the UI later must not silently promote a sample account, path, model, or reasoning value into user configuration.

## Implications on adoption

This is a local developer build for UI review, not a Homebrew cask or a downloadable release. It requires a macOS 27 development host and an Xcode toolchain supporting the current manifest, plus the repository's existing mise/Tuist setup. It needs no provider account, running adapter, installed helper, configuration file, or Sesh registration.

The prototype remains unsigned under the current project settings. No Developer ID, notarization, installation into `/Applications`, quarantine workaround, publishing, or Sesh access is part of adoption. Closing the app leaves the user's real settings and sessions untouched.

## Scope

- A runnable UI-only application in the existing Pico target, with single-window lifecycle and native sidebar navigation.
- Six representative pane layouts and explicitly labelled, process-local demonstration interactions for visual iteration.
- Real native build/test/run tasks, behavioral coverage, accessibility checks, and an exercised local app preview.
- A guide and focused revisions to the brief, contract, issue boundary, and current-state documentation; preserve macOS 27 and the existing version source.

### Out of scope

- The versioned configuration contract in #12, reading or writing actual settings, persistence, live changes, and session precedence. #12 is not a dependency of this UI-only slice.
- Runtime readiness detection, helper discovery or bundling, engine version inspection, credential access, provider authentication, real model catalogs, or operational diagnostic collection.
- Sesh setup/registration, adapter behavior, process channels, network services, and changes to the user's OMP configuration or active Sesh agent.
- A separate prototype target, webview, menu-bar app, custom UI framework, shipping package, signing/notarization, or release.
- Completion of #18's original real-data General pane or the full companion app described in the brief. Those integration outcomes require their own approved intent and evidence.

## Preview

- Repository shape: native macOS app built from this branch's existing Tuist target.
- Artifact: the actual local Debug `Pico.app` produced by `mise run macos:build` and opened by `mise run macos:run`. This is the cheapest realistic surface for visual refinement; screenshots can accompany it but do not replace it.
- Access: the local checkout and generated `.app`, without publication, installation over another app, or a provider/Sesh connection. The unsigned local build is not represented as distribution-ready.
- Exercise: the native navigation, grouped pane layouts, local demonstration interactions, scrolling, resizing, appearance, and accessibility checks in Detailed design. All panes remain visibly prototype-only.
- Completion cleanup: quit this branch's app and remove only implementation-owned temporary captures and test data. Keep normal ignored build output available for review. No external account, registration, service, or secret needs cleanup.
- Current state: no app preview exists during proposal development; no app sources are added until the human approves implementation.

## Policies and decisions checked

- Formal policy records: None. `policies/` contains only its index.
- Formal decision records: None. `decisions/` contains only its index.
- [VISION.md](../VISION.md) keeps the companion native and leaves conversation UI in Sesh. The workspace preserves that direction but claims only UI behavior, not configured capabilities.
- [PROTOTYPE.md](../PROTOTYPE.md#native-macos-configuration-app) supplies the System Settings reference and destination vocabulary. This proposal explicitly revises its “no unconnected panes” staging restriction for a labelled, local UI workspace; its real integration outcomes remain unfulfilled.
- The agent contract's source-free and no-placeholder-source restrictions require a matching narrow revision when this proposal is implemented. A completed navigable UI prototype is allowed; an empty entry point, fake connection, or inert operation pretending to work is not.
- `Project.swift` remains the source of truth for the generated project. Mark chose macOS 27, resolving its conflict with the older floor in the prose. `Config/Version.xcconfig` remains projected from Changesets.
- [Proposal 0002](0002-pico-homebrew-distribution.md) remains the executable's install/update contract. This UI workspace changes neither the formula nor the signing and packaging prerequisites for a future app distribution.

## Future directions

Approved integration proposals can connect individual panes to the shared configuration contract and public SDK operations, replacing demonstration content rather than treating it as a saved preference. The visual design can be refined against this workspace before those boundaries are implemented. No future service layer, schema, or authentication flow is designed here.

## Alternatives considered

- **Separate prototype target:** isolates demonstration content from the product target, but duplicates app/workspace setup and creates a later integration step. Mark selected the existing Pico target instead.
- **Wait for #12 and implement a real-data General pane first:** follows #18's original boundary and avoids an unconnected UI stage, but prevents the requested workspace and visual iteration from proceeding independently. Mark explicitly chose UI-first work.
- **Only an empty shell or SwiftUI previews:** cheaper to compile, but does not provide the full running navigation and representative pane layouts needed to assess the design. Previews can supplement the app, not replace it.

## Open questions

None about the selected scope, target, or macOS floor. Visual refinements remain part of implementation and human preview. This proposal remains `draft`; the human has not approved implementation.
