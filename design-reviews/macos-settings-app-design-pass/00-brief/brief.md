# Brief: Pico Mac settings app design pass

Version 1, frozen 2026-11-07. Every first-pass reviewer receives this version.

## Request

Mark asked for “a design pass on the macOS settings app for Pico” using the Design Council skills. A design pass is read as authorization to review the whole app and revise its look and feel. Breadth: **whole-product review** of the settings app (all six panes, sidebar, search, toolbar, shared rows). Mode: **review and revise**, limited to look and feel.

## User and task

- **User.** A developer who uses Sesh as their conversation UI and wants OMP's agent engine behind it. They install `pico` with Homebrew and configure it in this native Mac app rather than in Terminal (source: `VISION.md`, `PROTOTYPE.md` § Native macOS configuration app). Mark is the primary user today. No user research exists.
- **Core jobs today** (connected behavior):
    1. Confirm Pico is installed and starts; recover through confirmed Homebrew actions when it does not (General › Runtime).
    2. Choose the default model and reasoning level for new sessions from the real catalog (Models).
    3. Find the settings file (General › Configuration).
    4. Understand the fixed built-in tool policy (Tools & Integrations).
    5. Find any pane or setting through sidebar search or a `pico://settings/...` link.
- **Not yet connected** (visible scaffold): Providers & Accounts, Sesh, Diagnostics & About, the Versions rows, the `intellisense` row. They must stay visibly unconnected: disabled or reading “Not connected”, to sighted users and accessibility clients alike (hard rule, `AGENTS.md`).

## Platform and references

- macOS 27, SwiftUI with AppKit only where SwiftUI cannot express a control. One fixed-width window (715 pt), fixed 215 pt sidebar, back/forward history, grouped `Form`s (`.formStyle(.grouped)`).
- Visual and interaction authority: macOS System Settings (native split-view sidebar, titled detail pane, grouped forms, restrained SF Symbols, system type and materials, standard controls). Avoid a web-dashboard or card-grid look. AI-settings reference: CodexBar's provider configuration (for Providers & Accounts once connected).
- Required support: keyboard navigation, Command-Comma, VoiceOver, Light/Dark, Increase Contrast, Reduce Motion (`PROTOTYPE.md`). Revealed rows are outlined by a shape, not color alone, and VoiceOver focus moves to them (proposal 0005).

## Success condition

Each pane's primary job and current state can be read at a glance; status, errors and unconnected scaffolding are honest and distinguishable; the window reads as a careful System Settings-style Mac app in both appearances; accessibility commitments hold. The council endorses a prioritized plan (≥ 80 %), no critical accessibility or core-task failure remains, and the accepted changes are verified on the running build.

## Permitted changes

Look and feel only (`polishing-a-ui` skill): layout, spacing, sizes, type, color, icons, which control presents a choice, wording that is not itself a requirement, and how a screen meets an accessibility commitment. Not permitted without a proposal: anything that changes what a user can do or find out — new settings, new data sources, new actions, removed capabilities, changed save/load semantics. Such findings become deferred decisions or Beads items.

Fixed constraints:

- Settings item slugs and pane slugs are a public link contract and never change; titles may.
- Never fabricate a capability or a success; unconnected controls stay visibly unconnected.
- Never fall back silently; failures reach the user with their cause (Error Details).
- Homebrew actions keep their per-action confirmation.
- Window width (715 pt) and fixed sidebar are Mark's chosen look; they may be questioned but not changed without Mark.
- No custom design system or schema-driven form renderer for six screens (proposal 0005).

## Prior work

A focused council on 2026-11-06 (Beads `pico-bfk.25`) refined General's runtime readiness, the settings-file and error rows, and the tool-policy list. Its reviewers scored 8.3, 9.2 and 9.4 / 10 on HIG fit. That pass did not cover the whole window, the scaffold panes, the Models states or the sidebar.

## Unknowns

- No user research or usability data; claims about mental models are hypotheses.
- Real VoiceOver navigation, keyboard traversal, Increase Contrast and localization have not been exercised in this run (see the evidence index for what was).
- Search results cannot be captured without stealing the user's keyboard focus; search behavior comes from code and tests.
- The provider catalog with real credentials is unavailable on this Mac (Keychain refuses the freshly built `pico`), so the working Models states use a disposable profile with local LM Studio-style models.
