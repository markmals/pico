# Evidence index

Captured 2026-11-07 between 14:05 and 14:35 CST on a MacBook (Apple M4, built-in Retina display, macOS 27.0.1) from this branch's Debug build (`mise run macos:build`, `mise run pico:build`, base commit `249db8c`).

The PNG captures named below are not committed (Mark's choice, to keep about 16 MB of screenshots out of the repository); they remain in the worktree that ran the review, `sesh/design-pass-on-macos-settings-app`. The `.ax.txt` accessibility outlines are committed.

## Method

- The app ran in the background so the user's keyboard focus was never taken: launched with `open -g -n`, navigated with `open -g -a <this build> pico://settings/...` links, and captured with `recon ui screenshot` (window backing store, 2× pixels) and `recon ui ax tree`. Each AX tree is condensed into an `.ax.txt` outline (role, label, value, state).
- **Every capture shows the inactive-window appearance**: gray traffic lights, a gray rather than accent-colored sidebar selection, and dimmer toolbar title. Active-window color is not captured.
- Windows are 715 × 849 pt (the tallest the display allows); the app's default height is 680 pt. Content below 680 pt would need scrolling at the default size.
- Dark captures (`4x-*`) come from a throwaway build that forced `.preferredColorScheme(.dark)` from a launch argument; the change was reverted immediately and is not part of the product.
- Profiles:
    - **Real**: Mark's actual Pico data with `-PicoExecutable .build/pico`. The login Keychain refuses this freshly built executable access to the selected Anthropic credential (`KEYCHAIN_ACCESS_DENIED`, status −25293, reproduced with `pico settings get`). Both `settings get` and `models list` fail, so General's settings-file row and Models show load failures. This is a genuine state a user can reach after reinstalling or rebuilding `pico`.
    - **Scratch**: a disposable `HOME` under `/tmp` and a local fake LM Studio server listing five models, plus macOS's on-device model. Settings were changed only in this scratch profile, with `pico settings update` or by writing the scratch `settings.json`.
    - **Missing**: scratch `HOME` and `-PicoExecutable` pointing at a nonexistent path.

## Captures (`before/`)

| File | Pane / state | Profile |
| --- | --- | --- |
| `01-general-light` | General: installed, startup passed, updates not checked, settings file **Couldn't load** (Keychain denial) | Real |
| `02-models-light` | Models: load failed, pickers disabled “Unavailable”, Try Again, collapsed Error Details | Real |
| `03-providers-light` | Providers & Accounts scaffold, disabled Add Provider… | Real |
| `04-tools-light` | Tools & Integrations: included/excluded policy, unconnected `intellisense` row | Real |
| `05-sesh-light` | Sesh scaffold, disabled Register | Real |
| `06-diagnostics-light` | Diagnostics & About scaffold | Real |
| `07-reveal-tools-wait-light` | Link `pico://settings/tools/wait`: Wait row outlined | Real |
| `08-reveal-general-settings-file-light` | Link to the settings-file row while it shows a failure | Real |
| `10-scratch-general-light` | General with the settings path shown; file not yet created | Scratch |
| `11-scratch-models-not-set-light` | Models first run: no saved default, “Not Set”, built-in fallback named in footer, sidebar badge “1” on Models | Scratch |
| `12-scratch-general-file-exists-light` | General after a default was saved | Scratch |
| `13-scratch-models-set-light` | Models working state: gpt-oss-20b / High, Default marker in the list | Scratch |
| `14-scratch-models-saved-unavailable-light` | Saved default `anthropic/claude-sonnet-5-5` absent from catalog: “(unavailable)” in picker, reasoning “Unavailable”, warning footer | Scratch |
| `15-scratch-general-invalid-file-light` | General while `settings.json` is invalid JSON (General shows only the path) | Scratch |
| `16-scratch-models-invalid-file-light` | Models with the invalid file: raw parse message, guidance, Show in Finder… | Scratch |
| `17-scratch-reveal-reasoning-light` | Link to `models/reasoning-level`: row outlined | Scratch |
| `30-missing-exec-general-680` | General with no executable: Installation Not found with Details; startup/updates Not checked; settings file Couldn't load | Missing |
| `31-missing-exec-models-680` | Models load failure with no executable | Missing |
| `32-rejected-link-alert-680` | Window dimmed behind the rejected-link alert | Missing |
| `32b-rejected-link-alert-panel` | The alert panel itself (“Pico Can't Open This Link”) | Missing |
| `40-scratch-general-dark` … `46-diagnostics-dark` | Dark appearance: General, Models set, Tools, Shell reveal, Sesh, Providers, Diagnostics | Scratch |

Despite their `-680` suffix, `30`–`32` were captured at 849 pt; the launch frame argument changed the position only.

## Observed behavior

- Deep links switched panes, scrolled, and outlined the target row without activating the app (front application stayed the user's throughout, checked with `lsappinfo front` after each capture).
- Returning to Models reloaded settings and catalog (`13` reflected a change made with the CLI while the app ran; `14` and `16` reflected files written while it ran).
- The sidebar badge's accessibility value reads “Default model not set” (`11-…ax.txt`, line 19).
- An unknown link shows an alert and leaves the window on its pane (`32`).

## Not captured; reviewers rely on code and tests

| State | Where it lives |
| --- | --- |
| Sidebar search results and “No Results” | `app/Search/SearchResultsList.swift`, `SettingsSearch.swift`, `SettingsSearchTests.swift` |
| Loading states (“Loading…”, “Checking…”, progress row with Cancel) | `app/Panes/ModelRows.swift`, `ModelDefaultsFooter.swift`, `app/Runtime/RuntimeSection.swift`, `RuntimeActivityStatus.swift` |
| Saving state and save-failure alert | `ModelDefaultsFooter.swift`, `app/Configuration/ModelSettingsAlert.swift` |
| Updates results (up to date, update available, newer than Homebrew, trust required, Homebrew missing/old, check failed) and recovery buttons | `app/Runtime/RuntimeUpdatesRow.swift`, `RuntimeRecoveryButton.swift`, `RuntimeSection.swift` |
| Homebrew confirmation dialogs | `app/Runtime/HomebrewAction+Presentation.swift`, `RuntimeSection.swift` |
| Expanded Error Details / Details disclosures | `app/Shared/CommandErrorDetails.swift`, `app/Runtime/RuntimeRowDetail.swift` |
| Empty catalog (“None available”) | `ModelRows.swift`, `ModelDefaultsFooter.swift` |
| Active-window appearance, Increase Contrast, Reduce Motion, keyboard-only traversal, VoiceOver speech | Not exercised in this run |

## Supplemental evidence for deliberation

Added after the first-pass reviews by the coordinator, to test claims about the System Settings reference (PLA-2, PER-2, PLA-4, PER-1, INF-1). Captured 2026-11-07 ≈ 14:55 with `recon ui screenshot` from System Settings opened in the background (`open -g`) on this Mac, then quit. Inactive-window appearance, 740 × 849 pt.

| File | What it shows |
| --- | --- |
| `reference/system-settings-general.png` | General opens with a header card: large centered icon, large title, one-sentence description. The toolbar shows no title while the card is visible. Sidebar tiles mix outline glyphs (General, Bluetooth, Network) with filled ones. The sidebar's “Software Update Available” badge is a gray capsule. |
| `reference/system-settings-network.png` | Network has no header card; the toolbar shows the pane title. Each service shows status as a colored dot plus secondary text beneath its name (green “Connected”/“Active”, gray “Inactive”, red “Not connected”). |
| `reference/system-settings-software-update.png` | Row-scoped actions (“Update Tonight”, “Update Now”) sit trailing inside their row; a status/value row (“Installed — macOS 27…”) uses trailing secondary text; the legal note is a centered footer. |

## Project requirements and sources

- `00-brief/brief.md` (frozen brief)
- `guides/refining-the-mac-app-ui.md` — the user-facing behavior of every pane
- `PROTOTYPE.md` § Native macOS configuration app; `proposals/0005-mac-app-ui-workspace.md` (window, navigation, search, links, reveal); `proposals/0007-pico-owned-configuration.md` (settings contract)
- `app/` — all SwiftUI sources; panes in `app/Panes/`, shared rows in `app/Shared/`, runtime rows in `app/Runtime/`, labels and search terms in `app/Settings/SettingsItem+Catalog.swift`, pane titles, summaries, symbols and tile colors in `app/Navigation/SettingsDestination.swift`
