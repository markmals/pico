# Revision round 1

Authorized by Mark's request for a design pass; limited to look and feel per the brief. Implemented 2026-11-07 from `../04-decisions/decisions.md` (plan version 2). One round; no material departures from the decisions except those noted.

| Decision | Files | What changed |
| --- | --- | --- |
| 1 Caution symbol | `app/Shared/CautionLabel.swift` (new: `CautionLabel`, `CautionSymbol`), `app/Shared/RowStatus.swift` (new), `app/Runtime/RuntimeCheckRow.swift`, `app/Runtime/RuntimeInstallationRow.swift`, `app/Runtime/RuntimeSection.swift`, `app/Panes/SettingsFileRow.swift`, `app/Panes/ModelDefaultsFooter.swift` | `exclamationmark.triangle.fill` in multicolor, hidden from accessibility, beside unchanged words. The symbol no longer sits inside a `.secondary` style. Informational footers (including the “Not Set” fallback) stay plain. Installation “Not found” is now an attention state. |
| 2 Expanded cause | `app/Shared/CommandErrorDetails.swift` | Disclosure starts expanded; 120 pt cap and scroll unchanged. “Not found” uses Error Details. |
| 3 Invalid file row | `app/Panes/ModelSettingsProblemRow.swift` (new), `app/Panes/ModelsPane.swift`, `app/Panes/ModelDefaultsFooter.swift` | Failed and invalid states share one in-group row: caution label, trailing action, path (invalid only), Error Details. Footer adds that Pico reads the file again on return to Models. |
| 4 Action placement | `app/Panes/ProvidersPane.swift` | Add Provider… trailing in the Providers row; duplicated section header removed. |
| 5 One element per row | `app/Shared/SettingsValueRow.swift`, `app/Shared/SettingsValue.swift`, `app/Panes/ToolPolicyRow.swift`, `app/Panes/ModelRows.swift` | Rows without a button expose one static-text element with label and value (“Read” / “Included”); rows with a button stay a named group. **Departure:** `.combine`, as proposed, produced an `AXUnknown` element whose value `recon` could not see, so the rows use `.ignore` with an explicit label, value and the static-text trait instead (see verification). |
| 6 Scaffold footers | `app/Panes/GeneralPane.swift`, `DiagnosticsPane.swift`, `SeshPane.swift`, `ToolsPane.swift`, `ProvidersPane.swift` | One “Pico doesn't … yet” voice; “scaffold” removed from the UI. |
| 7 Sesh “Not checked” | `app/Panes/SeshPane.swift` | Three status rows read “Not checked”; Register stays disabled; every Sesh group keeps a footer. |
| 8 Confirmation copy | `app/Runtime/HomebrewAction+Presentation.swift` | All four confirmations say closing Pico stops Homebrew. |
| 9 Words | `app/Runtime/RuntimeUpdatesRow.swift`, `app/Settings/SettingsItem+Catalog.swift` | “Not in Homebrew”, “Command link missing”; “`pico` location” (slug and search term “helper” kept). |
| 10 Tile size | `app/Shared/AppIconTile.swift`, `app/Navigation/DestinationList.swift`, `app/Search/SearchResultsList.swift` | Tiles read `sidebarRowSize`: 16 / 20 / 24 pt. |
| 11 Toolbar title | `app/Navigation/PaneHeaderVisibility.swift` (new), `app/Panes/PaneHeader.swift`, `app/Navigation/SettingsWindowView.swift` | Header reports `onScrollVisibilityChange`; the toolbar removes its displayed title while the visible pane's header is on screen. `.navigationTitle` still sets the window title. |

Also updated: `guides/refining-the-mac-app-ui.md` (window, runtime, settings file and recovery sections), `.changeset/calm-panes-speak.md`.

Not changed: settings item and pane slugs, the “Not connected” value on other scaffold rows, any save/load or Homebrew behavior, the string catalog (`Localizable.xcstrings` has not been re-extracted in recent changes either).

## Round 1b — corrections from the reviewers' reassessment

| Request | Files |
| --- | --- |
| Trust confirmation sentence order (TrustReviewer) | `app/Runtime/HomebrewAction+Presentation.swift` |
| One Versions label set (InformationReviewer) | `app/Settings/SettingsItem+Catalog.swift` (Diagnostics' version rows: titles and search terms) |
| Typographic apostrophes in on-screen chrome (InformationReviewer) | `app/Navigation/ScaffoldNotice.swift`, `app/Panes/ModelDefaultsFooter.swift`, `app/Navigation/SettingsWindowView.swift`; guide quote updated |
| Attention status in primary text (PerceptionReviewer) | `app/Shared/RowStatus.swift` |
| Plain-text accessibility labels (AccessibilityReviewer) | `app/Settings/SettingsItem.swift` (`plainTitle`), `app/Shared/SettingsValueRow.swift`, `app/Panes/ToolPolicyRow.swift`, `app/Panes/SettingsFileRow.swift`, `app/Runtime/RuntimeCheckRow.swift`, `app/Shared/UnavailablePicker.swift` |

## Round 1c — regression fix found during verification

`app/Shared/SettingsValueRow.swift`: the row identity (`settingsRow`) moves from a wrapping `Group` into each branch. Applied to the `Group`, it stopped `pico://` links from scrolling to value rows (A/B against the pre-change build in `06-verification/results.md`).
