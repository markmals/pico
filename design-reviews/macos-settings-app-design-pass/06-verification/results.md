# Verification

Round 1, 2026-11-07, against the build of `05-revision/changes.md`. Captures in `../01-evidence/after/`, taken the same way as the before set (background launch, `pico://` links, `recon`), at 715 × 849 pt unless noted. The user's Mac locked partway through; captures continued (the window server still renders), but accessibility trees and animated scrolling did not work while it was locked. Each claim below names its evidence level.

## Captures (`after/`)

Same state and number as the before set: `01`–`08` real profile, `10`–`17` scratch profile, `30`–`31` missing executable, `40`–`46` dark (throwaway build, reverted). Added: `01`/`02-…-dark` (real-profile failures in Dark), `33`–`35` a 572 pt window (scroll checks).

## Decision checks

| # | Check | Result | Evidence level |
| --- | --- | --- | --- |
| 1 | Caution symbol appears beside every attention state and nowhere informational | Seen on settings file couldn't load (`01`, `08`, `30`), Installation not found (`30`, `35`), Models couldn't load (`02`, `31`), invalid file (`16`), saved model unavailable (`14`). Absent from `11` (“Until you choose a model…”), `13`, `12` and all scaffold panes. | Screenshot |
| 1 | Symbol hidden from accessibility | `01-general-light.ax.txt`: the settings-file group lists label, “Couldn't load”, Try Again and Error Details; no image element. | AX tree (`recon`) |
| 1 | Symbol contrast against the group fill | Light **1.41:1** (fill `#F7CE46` on `#F7F7F7`); white footer background 1.51:1; Dark **10.88:1** (`#F8D849` on `#252525`). Sampled from `01`, `14`, `16`, `01-general-dark`. Light fails PerceptionReviewer's 3:1 condition; the words carry the meaning. Increase Contrast could not be simulated: an `NSApp.appearance` high-contrast override in the throwaway build changed nothing visible, so those captures were discarded. | Pixel sampling |
| 2 | Error Details open on failure, capped | `01`: open, one-sentence Keychain cause visible, Try Again in place. `16`: parse message visible. `30`: “Pico couldn't use … as the pico command” visible under Installation. AX: `AXDisclosureTriangle … value=true`. | Screenshot, AX tree |
| 3 | Invalid file row | `16`: caution row inside Defaults, trailing Show in Finder…, path, open Error Details, footer with the return-to-Models sentence. | Screenshot |
| 4 | Providers action in row | `03`: Add Provider… trailing in the Providers row, disabled; no duplicate header. AX: group “Providers” containing the disabled button. | Screenshot, AX tree |
| 5 | One element per row | Final build, unlocked Mac: every scaffold value row is one `AXStaticText` with label and value — Versions (General and Diagnostics), `intellisense` location, `pico` location, Launch arguments, Connection status, Setup status, Recent errors, Diagnostic report (`01`, `04`, `05`, `06` `.ax.txt`). Tools rows read `"Read" value "Included"`; Available models rows read `"gpt-oss-20b" value "lm-studio/openai/gpt-oss-20b, Default"` (`13-scratch-models-set-short.ax.txt`). Rows with a button stay a named group: “Sesh custom agent” with disabled Register, “Providers” with disabled Add Provider…. `.combine` first produced `AXUnknown` with no value, so the rows use an explicit plain-text label, value and the static-text trait. | AX tree |
| 6–7 | Scaffold wording | `03`, `05`, `06`, `04`, `01`: new footers; Sesh status rows read “Not checked”; Register disabled; every Sesh group has a footer. | Screenshot |
| 8 | Confirmation copy | Not rendered: confirmations need a recovery state and a click. Strings verified in source. | Source only |
| 9 | Words | `05`: “`pico` location”. Updates states “Not in Homebrew” / “Command link missing” need Homebrew states not reproduced. | Screenshot / source |
| 10 | Tile size | Default (Medium) tiles unchanged at 20 pt in every capture. Small and Large not exercised: changing Sidebar icon size is a global setting. | Screenshot |
| 11 | Toolbar title | Hidden while the pane's header is on screen (`01`, `33`, `36`); shown once a reveal scrolls the header away (`34`, `35`, `37`: toolbar `AXStaticText` present); window title kept throughout (`AXWindow title=…`). | Screenshot, AX tree |
| — | `pico://` reveal scrolling | **Regression found and fixed.** In a 572 pt window the Tools `intellisense` location and General OMP reveals did not scroll (`34`/`35` first captures). A/B against the pre-change build (`before/90`, `before/91`) showed the baseline scrolled; probes isolated the cause to `SettingsValueRow` applying the row identity to a wrapping `Group`. With the identity inside each branch, reveals scroll and outline the row again (`34`, `35`, `37`). Tool and settings-file rows were unaffected. | Screenshot, A/B build |

## Still to verify

- Reveal focus moving VoiceOver to the row: with VoiceOver off the AX trees show no focus change, before or after, so it needs a VoiceOver pass (`pico-bfk.34`), as do speech and keyboard traversal.
- Increase Contrast, including the caution symbol and disabled pop-ups (`pico-bfk.35`).
- Sidebar tiles at Small and Large Sidebar icon size; active-window appearance.
- Homebrew confirmation rendering and the Updates states.

## Reviewer reassessment (round 1)

Each original reviewer received `05-revision/changes.md`, this file and the after captures, and replied independently. Scores are lens scores, not conformance results.

| Reviewer | Disposition | Before → after | Corrections requested |
| --- | --- | --- | --- |
| Platform | accept with qualifications | 8 → 9 | none |
| Interaction | accept with qualifications | 6 → 7 | none; the title-return check must close before decision 11 is done; the badge inversion is now starker (deferred `pico-bfk.27`) |
| Trust | accept with qualifications | 7 → 8 | Trust confirmation: “keep Pico open” read as referring to the install |
| Information | accept with qualifications | 6 → 8 | unify the two Versions label sets; three straight apostrophes in on-screen chrome |
| Perception | accept with qualifications | 6 → 8 | attention status text still secondary gray |
| Accessibility | request corrections | 6 → 7 (8 once fixed and confirmed) | the `intellisense` location row exposed no value in `04-tools-light.ax.txt` (hard-rule regression); same risk for `` `pico` location `` and `` `pico` version `` |

All six accepted the native multicolor caution yellow: it is the system's own symbol, redundant to the words and hidden from accessibility. PerceptionReviewer withdrew 3:1 as a condition (“prudential, not conformance”); Increase Contrast stays open in `pico-bfk.35`.

### Corrections applied (round 1b)

| Request | Change |
| --- | --- |
| Trust (TrustReviewer) | `HomebrewAction+Presentation.swift`: “Keep Pico open until Homebrew finishes; closing Pico stops it.” now precedes the install sentence. |
| Versions labels (InformationReviewer) | Diagnostics' rows now read “Pico app”, “`pico`”, “OMP” like General's, with the same search terms; slugs unchanged. |
| Apostrophes (InformationReviewer) | `ScaffoldNotice.swift`, `ModelDefaultsFooter.swift`, `SettingsWindowView.swift` use ’; error strings elsewhere were left as they are. |
| Attention text (PerceptionReviewer) | `RowStatus` draws attention statuses in primary text (`after/01`, `after/30` re-captured). |
| Missing values (AccessibilityReviewer) | Every accessibility label built from a settings title now uses the plain title (`SettingsItem.plainTitle`) instead of the attributed one. Note: the Tools tree AccessibilityReviewer read was captured before the static-text trait was added to `SettingsValueRow`, so the trait may also explain the missing value; both are now in place. Re-captured on the unlocked Mac: all those rows now expose their values (decision 5 above). |

### Round 1c

While closing the verification items, the reveal-scrolling regression above was found and fixed (`app/Shared/SettingsValueRow.swift`). It came from the decision 5 restructuring; no reviewer had flagged it because every earlier reveal capture fitted without scrolling.

### Final confirmations

- **AccessibilityReviewer — accept, 8/10.** “ACC-1 and ACC-5(a) are closed on evidence. Open and untestable here: VoiceOver speech and reveal focus (bfk.34), Increase Contrast and ACC-2's 1.87:1 (bfk.35), ACC-4 announcements, keyboard traversal.”
- **InteractionReviewer — accept with qualifications, 7/10.** “My condition is met: I opened after/37, where the reveal scrolled the Wait row into view with the toolbar title restored.” Would schedule `pico-bfk.27` (badge) and `pico-bfk.28` (Homebrew cancel/quit) first.
