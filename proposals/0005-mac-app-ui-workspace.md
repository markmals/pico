---
id: proposal.0005
title: Mac App UI Workspace
authors: [Mark Malstrom]
status: awaiting-implementation
pull-request: https://github.com/markmals/pico/pull/41
issues: [https://github.com/markmals/pico/issues/18]
supersedes: []
---

# Mac App UI Workspace

## Summary

Scaffold the existing Pico target's native macOS 27 window, navigation, and settings-pane layouts for visual refinement. Configuration controls remain unconnected UI stubs. Their functionality is deferred until issue #12's configuration contract exists; this proposal adds neither real configuration behavior nor an interactive demonstration model.

## Motivation

Pico's native target has project metadata but no sources or window. Generating the Xcode workspace cannot answer whether its navigation, forms, sizing, or typography work in a real Mac app. Mark needs a runnable UI to iterate on before implementing the configuration contract and connecting it to the adapter.

[Issue #18](https://github.com/markmals/pico/issues/18) originally combines that workspace with a General pane backed by real runtime and configuration data. This proposal covers only its UI scaffolding. Mark selected the existing Pico target and macOS 27, and explicitly deferred settings functionality until [#12](https://github.com/markmals/pico/issues/12) is implemented. The scaffold can proceed before #12; connecting its controls cannot.

## Domain grounding

### Established context

- Apple's [Window documentation](https://developer.apple.com/documentation/swiftui/window) defines a single, unique window that can be the app's primary scene. Opening its identifier again brings the existing window forward. With a single primary `Window`, closing it quits the app by default.
- Apple's [SwiftUI navigation guidance](https://developer.apple.com/videos/play/wwdc2022/10054/) combines `NavigationSplitView`, a sidebar `List`, and explicit selection for native multicolumn navigation. Selection and navigation state are distinct from the content being inspected.
- Apple's [grouped form style](https://developer.apple.com/documentation/swiftui/formstyle/grouped) provides grouped rows with leading labels and trailing controls. Its [sidebar guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars) favors familiar symbols, descriptive labels, discoverable navigation, and respecting the system accent color.
- Apple's [settings guidance](https://developer.apple.com/design/human-interface-guidelines/settings) establishes the App menu's Settings command, Command-Comma, and a title reflecting the visible pane. Its conventional toolbar-based preferences layout is not this project's chosen composition: the brief explicitly chooses the System Settings sidebar layout.

### Relevant constraints and principles

The visual authority is macOS System Settings: native sidebar selection, a titled detail pane, grouped forms, SF Symbols, and system typography and materials. This is a local desktop utility, not a web dashboard, quota monitor, menu-bar app, or second conversation UI.

A pane stub is a visual layout, not a configured setting, authenticated account, installed engine, or observed readiness state. A navigation destination does not advertise an adapter capability. Unconnected controls must look unavailable rather than imply that Pico can save or apply them.

### Quality bar

The workspace launches as an actual app with six pane layouts and working navigation and scrolling. It supports visual refinement of hierarchy, spacing, sizing, typography, and native controls. Settings remain visibly unconnected; no demonstration behavior or data-loading layer is needed.

### Remaining uncertainty

Exact spacing, symbol choices, and control density are refined against the running app during implementation and human preview. #12 determines the later configuration contract. This proposal does not predesign that contract or assume provider, credential, runtime, or Sesh APIs.

## Existing baseline

`Project.swift` defines a source-free macOS app target named `Pico`, bundle identifier `me.malstrom.pico`, Swift 6, complete strict concurrency, and `ExistentialAny`. Its actual deployment floor is macOS 27, despite macOS 14 statements in the brief and agent contract. Signing is disabled, and no App Sandbox integration is configured. Preserve these project settings; align the stale floor documentation with Mark's macOS 27 choice.

`Config/Version.xcconfig` projects the package version into the app build settings. Preserve that ownership instead of hand-editing `MARKETING_VERSION` or creating a second app version source.

The existing `macos:generate`, `macos:open`, formatting, and `macos:check` tasks validate project configuration. There are no app sources, native test targets, build task, or launch task. `mise run check` invokes the native configuration check on macOS and preserves the Bun gate on other hosts.

The native-app section of [PROTOTYPE.md](../PROTOTYPE.md#native-macos-configuration-app) supplies the visual reference and six destinations. Its ban on unconnected panes and the contract's source-free-until-functional rule currently exclude the requested UI stage. They need a narrow, explicit revision on implementation, not a silent interpretation that these screens configure Pico.

## Proposed solution

Use the existing Pico app target for one native settings-style window with six sidebar destinations and grouped pane layouts. Configuration rows and controls are static, visibly unconnected stubs. Only window management, navigation, and scrolling work. Do not create a separate prototype target, mock configuration service, or interactive demonstration model.

```text
Launch Pico → choose a pane → inspect and refine its unconnected UI
After #12 is implemented → connect settings in subsequent implementation work
```

The deliverable is the UI scaffold, not a functional configuration app. It must be runnable for visual iteration, but it need not simulate the functionality that will be added later.

## Detailed design

### Stub boundary

The shared window displays a concise notice equivalent to “UI scaffold — configuration not connected.” Configuration controls remain disabled or display an explicit unconnected value. Any control shown for layout must make its unavailable state clear to both sighted users and accessibility clients.

Do not add editable demonstration settings, populated sample accounts or model catalogs, working search/filter behavior, simulated authentication, fake progress, or successful-looking save/apply results. Use neutral placeholders such as “Not connected” rather than inventing a configured value. A search field or picker can be present as a disabled layout stub.

The app performs no configuration read/write, persistence, credential access, provider request, runtime discovery, helper launch, diagnostic collection, or Sesh operation. Version, runtime-status, and configuration-location rows are also unconnected UI; this slice does not load their real values.

Do not define a configuration schema, backend protocol, mock service, or future integration abstraction to support these stubs. #12 remains the prerequisite for adding configuration functionality; its completion does not itself imply that every provider or Sesh workflow has been implemented.

### Window and navigation

The app uses a single primary SwiftUI `Window` scene, with AppKit only where a required native interaction cannot be expressed through SwiftUI. Launch opens General. The App menu's Settings command and Command-Comma bring this same window forward rather than making a second settings window. Retain the single-window scene's normal close-to-quit behavior; reopening the app starts a fresh UI session.

A two-column `NavigationSplitView` contains a native sidebar list and the selected detail pane. Its destinations, in order, are General, Providers & Accounts, Models, Tools & Integrations, Sesh, and Diagnostics & About. Each row has a restrained SF Symbol and a visible selected state. The detail title identifies the active destination. No additional onboarding window, status menu, dashboard, search destination, or chat view is introduced.

Use stable destination identities rather than labels or list indices. Selection and each pane's scroll position survive navigation within the current process. There are no editable setting values or filters to retain. No cross-launch restoration or settings persistence is required.

Start with a 920-by-680-point default window and a 760-by-520-point minimum. Use a sidebar with a 240-point ideal width and a 220-to-320-point range. These are initial visual-iteration dimensions, not fixed-size screenshots: resizing keeps the layout readable, wraps explanatory text, and allows the detail content to scroll. Standard sidebar visibility controls remain available. Human visual refinements may adjust these dimensions without adding configuration behavior.

### Pane stubs

Every pane uses system text styles, grouped forms or native lists where appropriate, standard controls, and explanatory copy adjacent to the relevant rows. The same row and section conventions recur across panes; do not introduce a generic schema-driven form renderer or a custom design system for six screens.

| Destination | UI stub |
| --- | --- |
| General | Grouped runtime, app/engine version, and configuration-location rows with unconnected values. No readiness checks or location selection. |
| Providers & Accounts | Provider/account section layout and disabled account/credential-source controls. No sample accounts, credential entry, sign-in flow, or provider discovery. |
| Models | Model and reasoning-selection layout with disabled controls. A catalog/search area may be laid out, but contains no fabricated catalog or working filter. |
| Tools & Integrations | Curated-policy explanation and unconnected integration-detail rows, including the eventual external `intellisense` location control. No executable selection or validation. |
| Sesh | Grouped launch-details and connection/setup layout with unconnected values and disabled actions. No registration or connection inspection. |
| Diagnostics & About | App-identity, version, and diagnostic-section layout. Version and diagnostic values are unconnected; no sample diagnostic results or collection/export behavior. |

These are visual structures for refinement, not full workflow implementations. Do not add setup sheets, authentication screens, sample-data systems, loading/error state machines, or recovery flows to make the scaffold appear functional.

Light and Dark appearances follow the system, as do accent color, Increase Contrast, and Reduce Motion. Navigation and scrolling work from the keyboard. VoiceOver announces destination labels, selected state, row labels, and the unavailable status of stubbed controls. Color or an icon alone cannot convey that a control is unconnected.

### Workspace and task integration

Put app sources under `app/`, grouped by app entry/navigation and pane. Point `Project.swift` at those sources; never edit the generated project. The entry point launches the actual navigable scaffold rather than an empty view.

Add the following mise tasks with the code that makes them real:

| Proposed task | Required result |
| --- | --- |
| `macos:build` | Generate through Tuist and compile the actual Debug app with `xcodebuild`, using `.build/macos` as the derived-data location. |
| `macos:run` | Build and open this checkout's `.build/macos/Build/Products/Debug/Pico.app`, not an older installed copy. |

Expand `macos:fmt` and `macos:lint` to include app sources. Extend `macos:check` from manifest inspection to building the app, retaining its non-macOS skip and the existing `mise run check` entry point. Do not add a package script block, second formatter, shell/Python wrapper, or placeholder release task.

This UI-only slice adds no configuration logic or demonstration behavior to unit-test. Do not introduce native test targets or a `macos:test` task merely to test static wiring, labels, or placeholder values. Preserve the existing suites and use the running app as the layout/navigation smoke check; add native behavioral tests with the functionality that warrants them.

### Implementation evidence and documentation

Write the UI-workspace guide from this proposal before the app code. Explain how to build, run, and inspect the scaffold, and that settings stay unconnected until #12 and the subsequent integration work. There is no configuration-persistence, real-runtime, or simulated-settings acceptance scenario in this slice.

After implementation, run `mise run check`. Launch with `mise run macos:run` and exercise the actual window: visit every pane, scroll away and back, use Command-Comma, and resize to the minimum and a larger window. Inspect Light/Dark, keyboard navigation, VoiceOver, Increase Contrast, and Reduce Motion. Confirm that configuration controls remain unconnected and cannot perform or simulate external actions. Record the exercised surface and any platform limitation rather than treating project generation or passing repository tests as visual proof.

Update the source-free descriptions, native command documentation, and macOS floor in the relevant existing repository documents. Revise the brief and agent contract narrowly to allow these explicit UI stubs before configuration functionality, retaining the prohibition on fake operational success. Update #18's description to distinguish this UI delivery from its original integration expectations and preserve #12 as the dependency for adding configuration functionality.

## Compatibility

The ACP adapter, Homebrew executable, credentials, Sesh registrations, and existing sessions are unchanged. No configuration contract, storage migration, credential reuse, or compatibility bridge is introduced. The app keeps `me.malstrom.pico` and the manifest's macOS 27 floor; this proposal does not promise macOS 14 support.

No placeholder value becomes a saved preference or a default for later integration. Future settings behavior uses #12's contract rather than turning layout stubs into a second configuration model.

## Implications on adoption

This is a local developer build for UI review, not a Homebrew cask or a downloadable release. It requires a macOS 27 development host and an Xcode toolchain supporting the current manifest, plus the repository's existing mise/Tuist setup. It needs no provider account, running adapter, installed helper, configuration file, or Sesh registration.

The prototype remains unsigned under the current project settings. No Developer ID, notarization, installation into `/Applications`, quarantine workaround, publishing, or Sesh access is part of adoption. Closing the app leaves the user's real settings and sessions untouched.

## Scope

- A runnable UI-only application in the existing Pico target, with single-window lifecycle and native sidebar navigation.
- Six settings-pane stubs with static layouts and visibly unconnected configuration controls.
- Native build/run tasks, formatting/build checks, accessibility inspection, and an exercised local app preview.
- A guide and focused revisions to the brief, contract, issue boundary, and current-state documentation; preserve macOS 27 and the existing version source.

### Out of scope

- Issue #12's configuration contract and all settings functionality: reading/writing settings, persistence, live changes, and session precedence. The scaffold can precede #12; configuration functionality waits for it.
- Runtime readiness detection, helper discovery or bundling, engine version inspection, credential access, provider authentication, real model catalogs, or operational diagnostic collection.
- Sesh setup/registration, adapter behavior, process channels, network services, and changes to the user's OMP configuration or active Sesh agent.
- Demonstration settings/state, sample accounts/catalogs, working model filters, simulated workflows, backend abstractions, and test infrastructure for those behaviors.
- A separate prototype target, webview, menu-bar app, custom UI framework, shipping package, signing/notarization, or release.
- Completion of #18's original real-data General pane or the full companion app described in the brief. Those integration outcomes require their own approved intent and evidence.

## Preview

- Repository shape: native macOS app built from this branch's existing Tuist target.
- Artifact: the actual local Debug `Pico.app` produced by `mise run macos:build` and opened by `mise run macos:run`. This is the cheapest realistic surface for visual refinement; screenshots can accompany it but do not replace it.
- Access: the local checkout and generated `.app`, without publication, installation over another app, or a provider/Sesh connection. The unsigned local build is not represented as distribution-ready.
- Exercise: native navigation, pane layouts, scrolling, resizing, appearance, and accessibility. Configuration controls remain visibly unconnected; no demonstration workflow is exercised.
- Completion cleanup: quit this branch's app and remove only implementation-owned temporary captures and test data. Keep normal ignored build output available for review. No external account, registration, service, or secret needs cleanup.
- Current state: no app preview exists during proposal development; no app sources are added until the human approves implementation.

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
- **Only an empty shell or SwiftUI previews:** cheaper to compile, but does not provide running sidebar navigation and pane layouts for visual refinement. Previews can supplement the scaffold, not replace it.

## Open questions

None about the selected scope, target, or macOS floor. Mark approved implementation on 2026-11-01. Visual refinements remain part of implementation and human preview; configuration functionality remains deferred until #12.
