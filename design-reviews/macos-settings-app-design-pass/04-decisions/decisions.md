# Decisions

Made 2026-11-07 by the council (six of six reviewers endorsed the plan, versions 1 and 2; see `../03-deliberation/votes.md`). Plan order proposed by the coordinator. Nothing here supersedes an earlier decision except where noted. A decision is not evidence that the change works; `../06-verification/results.md` records what was checked.

Brief jobs: (1) confirm Pico runs and recover, (2) choose model defaults, (3) find the settings file, (4) understand the tool policy, (5) find any setting.

## Accepted — implement now (look and feel)

| # | Decision | Findings | Jobs |
| --- | --- | --- | --- |
| 1 | Attention states (runtime failures including “Not found”, settings file couldn't load, Models couldn't load, invalid settings file, saved model or level unavailable, no usable model, no default with no automatic fallback, Homebrew action failed) carry the system caution symbol (`exclamationmark.triangle.fill`, multicolor) beside unchanged words. The symbol is hidden from accessibility and no longer inherits `.secondary`. Informational footers and benign values stay plain. | PLA-1, PER-1, ACC-5 | 1, 2, 3 |
| 2 | Error Details opens expanded when a failure appears; its 120 pt cap and scrolling stay. “Not found” uses Error Details for its cause. | TRU-1, INT-3 | 1, 2, 3 |
| 3 | An invalid settings file becomes a caution row inside Models › Defaults: “Pico can't read its settings file”, trailing Show in Finder…, the file's path, and the parse message under Error Details. The footer keeps “Fix or remove…” and adds that Pico reads the file again when you return to Models. | INF-2, INT-4, PLA-3, PER-5; A1, A4 | 2, 3 |
| 4 | Row-scoped actions sit trailing inside their row: Add Provider… moves into the Providers row (still disabled) and the duplicated “Providers” section header goes. Runtime's check buttons keep the 2026-11-06 placement. | PLA-3, PER-5, PLA-2 (Providers part) | — |
| 5 | Each value row, tool policy row and Available models row is one accessibility element; rows with a button keep `.contain` with the row's label. Existing labels and disabled states are preserved. | ACC-1, ACC-3 | 2, 4, 5 |
| 6 | Scaffold footers speak in one voice about what Pico doesn't do yet; “scaffold” leaves the UI. Providers says accounts aren't shown here yet and are managed with `pico`'s commands. Every Sesh group keeps a footer, and Connection's says Pico can't check Sesh yet. | INF-1, TRU-4 | — |
| 7 | Sesh custom agent, Connection status and Setup status read “Not checked”, not “Not connected”. Other scaffold rows keep “Not connected”. | INF-1, TRU qualification on F; A3 | — |
| 8 | Install, Reinstall, Update and Trust confirmations say that closing Pico stops Homebrew. | INT-1, TRU-2; A5 | 1 |
| 9 | Updates row stops reusing Installation's words: “Not in Homebrew”, “Command link missing”. Sesh's “Helper location” becomes “`pico` location” (slug unchanged; “helper” stays a search term). | INF-4 (narrow) | 1, 5 |
| 10 | Sidebar and search-result tiles follow the system Sidebar icon size; the header tile stays fixed. | PLA-4 (size part) | 5 |
| 11 | The toolbar stops displaying the pane title while that pane's header card is on screen and shows it once the card scrolls away; the window title stays. | PLA-2, PER-2; A2 | — |

## Deferred — Mark's decision or a proposal (Beads items)

| Item | Why deferred | Findings |
| --- | --- | --- |
| Badge trigger tracks consequence (saved model unavailable, load failure, invalid file) rather than an unset default; badge prominence | Changes what the sidebar tells the user. Reference: System Settings' own update badge is a gray capsule. | INT-2, TRU-3 |
| Cancel or confirm-before-quit for a running Homebrew action; showing Homebrew's progress | New action and new information. Decision 8 is a mitigation, not the fix. | INT-1, TRU-2 |
| Try Again for an invalid settings file; General reporting an invalid file | New action; new information on General. | INT-4, INF-2 |
| Versions in one place only | Removes rows and link targets. | INF-3 |
| `brew` as a search term | Changes what search finds; blocks Homebrew recovery by search (job 1). | INF-5 |
| `json`/`updates` terms, substring matching, ⌘F, rejected-link alert listing panes | Changes what can be found; ⌘F needs a keyboard test this session cannot run without the user's focus. | INF-5, INT-5 |
| Tap-trust lifetime sentence and default button | Lifetime claim needs Homebrew 6 verification; the button reverses a 2026-11-06 council decision. | TRU-5 |
| VoiceOver announcements for check results and search counts | Cannot be verified without VoiceOver. AccessibilityReviewer asked to ship the check-result half now; dissent preserved. | ACC-4 |
| Renaming “Runtime” / “Check Runtime” | Contested with the project's “runtime readiness” vocabulary. | INF-4 |
| Default marker beside its model | Decision 5 fixes the VoiceOver association; the visual gap remains (PerceptionReviewer: deferred, not solved). | PER-4 |

Beads, in table order: `pico-bfk.27` (badge), `pico-bfk.28` (Homebrew cancel), `pico-bfk.29` (invalid file), `pico-bfk.30` (versions), `pico-bfk.31` (`brew`), `pico-bfk.32` (search), `pico-bfk.33` (tap trust), `pico-bfk.34` (VoiceOver pass and announcements), `pico-bfk.36` (Runtime naming), `pico-bfk.37` (Default marker). ACC-2 and the caution-symbol contrast condition: `pico-bfk.35`.

## Rejected

| Proposal | Reason | Findings |
| --- | --- | --- |
| Remove or shrink the pane header card | System Settings opens General with the same card (`reference/system-settings-general.png`); proposal 0005 adopted it. Narrowed to decision 11 instead. | PLA-2, PER-2 |
| Merge Included and Excluded tools | The 2026-11-06 council and the guide chose separate groups. | PER-3a |
| Dim or quiet scaffold rows | Conflicts with measured contrast and the Increase Contrast commitment. | PLA-5, PER-3b |
| Swap sidebar glyphs for filled ones | System Settings mixes outline and filled glyphs. | PLA-4 |
| Rename Sesh rows to “Connection”/“Setup” | “Connection — Not connected” reads more like a verdict. | INF-1 |
| Replace disabled pop-ups with static text | A dimmed pop-up is the platform's disabled control. **ACC-2 stays open** until measured with Increase Contrast, including the unexplained “Not Set” Reasoning row. | ACC-2 |

## Visual council disposition

Not run. The brief fixes the composition to macOS System Settings (Mark's reference, proposal 0005), and every accepted change repairs a platform convention with a first-party precedent visible in the captured System Settings references: the system caution symbol, trailing in-row actions, and the hidden toolbar title beside a header card. No brand, identity or layout direction was requested or left open; the remaining visual choices (symbol and color) are system-defined. Mark can commission a visual council for a later identity study.
