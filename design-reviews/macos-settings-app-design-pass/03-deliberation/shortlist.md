# Shortlist and proposed plan

Version 1, circulated 2026-11-07. Proposed by the coordinator (the session agent running the council) after all six first-pass reports were preserved in `02-reviews/`. The order below is the coordinator's; no reviewer ranked it before seeing it.

Supplemental evidence shared with this version: `01-evidence/reference/system-settings-{general,network,software-update}.png` (coordinator probe; see the evidence index).

## How findings cluster

| Cluster | Findings | Independent reviewers |
| --- | --- | --- |
| A. Failure and warning states look like benign values | PLA-1, PER-1, ACC-5 | 3 |
| B. A failure's cause is hidden behind a collapsed disclosure | TRU-1, INT-3 | 2 |
| C. Invalid settings file on Models is raw footer prose with a stray button | INF-2, INT-4, PLA-3, PER-5 | 4 |
| D. Buttons sit in four different places relative to their group | PLA-3, PER-5 | 2 |
| E. Rows read as loose fragments to VoiceOver; reveal focus has nothing to bind to | ACC-1, ACC-3 | 1 |
| F. Scaffold footers are inconsistent, use “scaffold”, and Providers implies the user's accounts are disconnected | INF-1, TRU-4, PLA-5 | 3 |
| G. One object has several names; “installed” collides across Runtime rows | INF-4, INF-3 | 1 |
| H. Sidebar tiles ignore the system sidebar icon size | PLA-4 | 1 |
| I. A running Homebrew action has no exit, and closing Pico silently stops it | INT-1, TRU-2 | 2 |
| J. The sidebar badge marks the benign state and not the failing ones | INT-2, TRU-3 | 2 |
| K. The pane header card | PLA-2, PER-2 (reduce or remove); INF “worth keeping” (keep) | 3, split |
| L. Search vocabulary, keyboard entry, and the rejected-link dead end | INF-5, INT-5 | 2 |
| M. Disabled pop-up text contrast (1.87:1) | ACC-2 | 1 |
| N. Default marker far from its model | PER-4 | 1 |
| O. Tap-trust disclosure and default button | TRU-5 | 1 |
| P. Announcements for check results and search counts | ACC-4 | 1 |

## Proposed plan: implement now (look and feel only)

1. **A — Severity encoding.** Every state that needs the user's attention (runtime row failures, settings file couldn't load, Models couldn't load, saved model or level unavailable, no usable model, invalid settings file, Homebrew action failed) gets the system caution symbol `exclamationmark.triangle.fill` drawn with the system's multicolor rendering (yellow triangle, as macOS alerts draw it) beside the existing words. Footer warnings on Models become a caution `Label`; informational footers stay plain secondary text. Benign values (“Installed”, “Passed”, paths, “Not connected”) stay secondary. Wording unchanged. Color is additive: symbol + text, never color alone.
2. **B — Show the cause.** Error Details opens expanded whenever a failure appears (settings file, Models, command startup, update check, Homebrew action). The existing 120 pt cap and scrolling stay; the user can still collapse it.
3. **C + D — One action placement rule.** Row-scoped actions sit trailing inside their row. On Models, an invalid settings file becomes a caution row inside Defaults (“Pico can't read its settings file” + trailing Show in Finder…) with the parse message under expanded Error Details and the existing “Fix or remove…” sentence as footer. On Providers, Add Provider… moves into the Providers row (still disabled), and the duplicated “Providers” section header is removed. Runtime's Check Runtime / Check for Updates stay where the 2026-11-06 council placed them.
4. **E — One accessibility element per row.** Tool policy rows, scaffold value rows and Available models rows each become a single combined element (“Wait, Included”; “gpt-oss-20b, lm-studio/openai/gpt-oss-20b, Default”). Rows with a button (Sesh custom agent) keep `.contain` with the row's label, as runtime rows already do. This also gives `pico://` reveal focus one element to land on.
5. **F — Scaffold footers in one honest voice.** Keep every “Not connected” value and disabled control exactly as they are (hard rule). Rewrite the scaffold footers to one pattern that says what _Pico_ doesn't do yet, drop “scaffold”, and make Providers' footer say that accounts aren't shown here yet and that credentials are managed with `pico`'s commands — so no footer reads as a verdict about the user's setup.
6. **I (copy only) — Say what closing does.** Install, Reinstall and Update confirmations add that closing Pico stops Homebrew, so keep it open until the action finishes. (Verified in code: window close and quit both cancel the running action.)
7. **G (narrow) — Don't reuse “installed”.** On the Updates row, Homebrew-state values stop reusing the Installation row's words: “Not installed” → “Not in Homebrew”, “Not linked” → “Command link missing”. Sesh's “Helper location” becomes “`pico` location” (slug unchanged; “helper” kept as a search term).
8. **H — Sidebar tile size follows the system.** Tiles in the sidebar and search results scale with the user's Sidebar icon size; the header tile stays fixed.

## Proposed deferrals (need Mark's decision or a proposal; recorded as Beads items)

- **J — Badge trigger.** Making the badge track consequence (saved model unavailable, load failure, invalid file) changes what the sidebar tells the user. Behavior decision for Mark.
- **I — Cancel / confirm-before-quit for Homebrew actions; showing Homebrew's progress output.** New actions and new information.
- **C — Try Again for an invalid file; General reporting an invalid file.** New action / new information on General.
- **INF-3 — Versions in one place only.** Removes rows and link targets.
- **L — Search synonyms (`brew`, `json`, `updates`), substring matching, ⌘F, rejected-link alert listing valid panes.** Changes what can be found; ⌘F needs a keyboard test this session cannot run without taking the user's focus.
- **INF-1 core — a placeholder other than “Not connected”.** The phrase is quoted by the hard rule in `AGENTS.md`; the System Settings Network reference shows “Not connected” used as a real red-dot verdict, which supports the concern, but the change is Mark's.
- **O — Tap-trust lifetime sentence and default button.** The lifetime claim needs Homebrew 6 verification; the default-button change reverses a 2026-11-06 council decision.
- **P — VoiceOver announcements.** Needs VoiceOver verification this session cannot run without taking over the user's audio and focus.
- **G (broad) — Renaming “Runtime” / “Check Runtime”.** Contested with the project's own “runtime readiness” vocabulary; worth Mark's call.

## Proposed rejections

- **K — Removing or shrinking the pane header card.** The System Settings reference (`system-settings-general.png`) opens General with exactly this kind of card, and proposal 0005 adopted it for parity. The fold cost at 680 pt falls on unconnected Versions rows. Dissent from PLA-2/PER-2 is preserved.
- **PER-3a — Merging Included and Excluded tools into one group.** The 2026-11-06 council and the guide chose separate groups.
- **PLA-5 / PER-3b — Dimming or quieting scaffold rows.** Conflicts with ACC-2/ACC-5's contrast measurements and the Increase Contrast commitment.
- **PLA-4 glyph swap.** System Settings itself mixes outline and filled glyphs in its tiles (reference capture).
- **INF-1 row renames** (“Connection”, “Setup”). “Connection — Not connected” reads even more like a verdict.
- **M — Replacing disabled pop-ups with static text.** A dimmed pop-up is the platform's disabled control, and WCAG exempts inactive controls; plan items 1–3 put a readable explanation beside every disabled state. ACC-2 stays **open** pending an Increase Contrast measurement this session cannot take.
- **N — Moving the Default marker.** Item 4 fixes the association for VoiceOver; the visual distance is a minor scan cost.

## Questions for each reviewer

1. Do you support this plan and its priorities? (support / object / abstain)
2. Which item, deferral or rejection would you change, and why?
3. Any condition that must hold for your support?

## Version 2 amendments (2026-11-07, after the version 1 ballots)

All six reviewers supported version 1 (`votes.md`). Their requested changes were adopted as follows; version 2 was circulated for objections.

- **A1 (InteractionReviewer).** Item 3: the invalid-file footer also says that Pico reads the file again when you return to Models — existing behavior, stated, not a new action.
- **A2 (PerceptionReviewer, PlatformReviewer; InformationReviewer kept the card).** Rejection K is narrowed, not reversed: the card stays, and the toolbar stops displaying the pane title while the pane's header card is on screen, as System Settings does (`reference/system-settings-general.png`). The window title stays for accessibility and the Window menu.
- **A3 (InformationReviewer; TrustReviewer's qualification on F).** Sesh's three status rows — Sesh custom agent, Connection status, Setup status — read “Not checked” instead of “Not connected”: Pico has performed no check, and macOS uses “Not connected” as a measured verdict (`reference/system-settings-network.png`). Register stays disabled; every Sesh group keeps a footer. Other scaffold rows keep “Not connected”.
- **A4 (InformationReviewer).** Item 3: the invalid-file caution row shows the settings file's path, so “this settings file” has an antecedent.
- **A5 (TrustReviewer).** Item 6 covers the Trust markmals/tap confirmation too.
- **Conditions adopted:** caution symbols are hidden from accessibility (ACC); `.secondary` no longer overrides the caution symbol (PLA); no caution on informational footers such as “Not Set” fallback (INT, PER); Error Details keeps its 120 pt cap and expands only for failures (TRU); the Cancel / confirm-before-quit deferral stays open as its own Beads item (INT); reveal focus is re-checked on a Tools row and the Available models header (ACC).
- **Not adopted:** AccessibilityReviewer's request to ship check-result announcements now. Announcements cannot be verified without VoiceOver, which this session cannot run without taking over the user's audio and focus; item 4's tree shape can be verified with `recon`. Deferred with a VoiceOver pass; dissent preserved. InformationReviewer's `brew` synonym stays deferred but is filed as its own item.
