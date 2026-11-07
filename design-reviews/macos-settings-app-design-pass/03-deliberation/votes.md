# Plan votes

Plan version: `shortlist.md` version 1, proposed by the coordinator. Each reviewer received it by direct message with the same ballot questions and replied without seeing other ballots. Ballots are the reviewers' own text, preserved verbatim.

## InteractionReviewer — support

> 1. **Plan vote: support.** The order treats the two failure paths my lens ranked highest (A severity encoding, B expanded cause) as now-work, and the C/D placement rule removes the stray footer button on Models. Item 6 is the right honest minimum for a change I labelled proposal.
>
> 2. **One change: the C deferral, narrowly.** Item 3 rebuilds the invalid-settings-file state into a caution row but still leaves no visible way to re-read the file after the user fixes it; they must discover that leaving and returning to Models reloads (`SettingsWindowView.swift:52-55`). Adding a Try Again is correctly deferred, but _saying_ what already happens is wording, not a new capability. Ask for one sentence in that footer — Pico re-reads the file when you return to Models — inside item 3. Without it the restyled row looks more actionable than it is, which is worse than today.
>
> 3. **Conditions.** (a) Item 6's copy is a mitigation, not a fix: the deferred Cancel / confirm-before-quit item must stay open as a Beads item, not be closed by the confirmation wording. (b) Item 1's caution symbol must not reach Models' "Not Set" fallback footer, which describes a working state.
>
> 4. **Qualification on J.** The supplemental `system-settings-general.png` strengthens it: the system's own sidebar badge ("Software Update Available 1") marks a state the user should act on. Pico's marks the one state that still works.

## PerceptionReviewer — support

> 1. **Plan vote: support.** Ordering is right: cluster A first is the fix my lens weighted highest, and `reference/system-settings-network.png` (inspected) backs the encoding — Wi-Fi/VPN/Firewall/Thunderbolt Bridge show a colored dot _plus_ text, never color alone. Item 3 matches `reference/system-settings-software-update.png`, where "Update Tonight"/"Update Now" sit trailing inside their row.
>
> 2. **Change: narrow the K rejection, don't drop it.** I accept the card has precedent, but the reference does not support what Pico ships. In `reference/system-settings-general.png` the toolbar is _empty_ while the card is visible, and the card appears only on the hub pane — `system-settings-network.png` has no card and shows the toolbar title instead. Pico prints the pane name three times within 250 pt (sidebar row, toolbar, card; `01-general-light.png`). Amendment: keep the card, remove the triplication — suppress the toolbar title while the card is visible, or drop the card's title line. Pure parity work, no capability change.
>
> 3. **Condition:** benign values stay monochrome as written, and the caution symbol is re-measured in dark and with Increase Contrast (≥3:1 against the card fill) before acceptance. If every Models footer becomes a caution Label, the yellow stops being a signal.
>
> 4. **Qualification on item 4:** it fixes the Default association for VoiceOver only; the 318 pt visual gap in `13-scratch-models-set-light.png` remains. I accept N as deferred, not solved.

## AccessibilityReviewer — support

> ACC ballot (read shortlist v1 + the three reference captures).
>
> 1. **Support.** Items 1 and 4 take ACC-5(a) and ACC-1/ACC-3 whole, and the rejections of PLA-5/PER-3b on contrast grounds are right.
>
> 2. **One change: don't defer P while shipping E.** Both rest on the same VoiceOver test this session can't run, yet E ships and P defers. Fold P's narrowest piece — announcing the terminal result of _Check Runtime_ and _Try Again_ — into item 4 and verify them in one pass; defer the search-count half. Otherwise the plan fixes how a row reads but leaves the outcome of the one recovery action in job 1 silent.
>
> 3. **Conditions.** (a) Every caution symbol added by item 1 is `.accessibilityHidden(true)`, as `RuntimeCheckRow.swift:17` already does — otherwise item 4's `.combine` folds the glyph name into the spoken row. (b) Item 4 preserves each row's existing `accessibilityLabel` and `disabled` state, and reveal focus is re-checked on one Tools row and one Available-models row before close.
>
> 4. **Qualifications.** On item 1: multicolor caution on a light row is ≈1.4:1 (systemYellow #FFCC00 on the measured #F7F7F7), so it only works because the words carry the meaning — keep "never color alone" literal. On rejection M: I accept the control choice, but the stated rationale doesn't cover `11-scratch-models-not-set-light.png`, where the disabled Reasoning row reads "Not Set" at 1.87:1 with no error beside it and no caution from item 1. Record that gap with the open ACC-2 item.

## PlatformReviewer — support

> Platform lens ballot (PLA)
>
> 1. **Plan vote: support.**
>
> 2. **Change: the K rejection — narrow it rather than reject it.** I opened the three reference captures. `system-settings-general.png` settles the card itself: precedented, and I withdraw "remove it". But that capture also shows the toolbar title _empty_ while the card is on screen, and `system-settings-network.png` shows the toolbar title present on a pane with no card. System Settings shows the pane's name once. Pico shows it three times at once — window/toolbar title, card title, selected sidebar row — on all six panes. I'd accept K narrowly as a one-line change: suppress the displayed toolbar title while the header card is visible (keeping the window's accessibility title, per HIG _Settings_ macOS), or drop the title line from the card. The fold arithmetic is not my argument; the duplication is.
>
> 3. **Condition.** Item 1 must lift the inherited `.secondary` in `SettingsFileRow.swift:20`, which currently forces the whole caution `Label` — triangle included — to secondary. Multicolor rendering is cancelled there otherwise and the fix stays cosmetic. Apply the same care to the new Models footer labels.
>
> 4. **Qualifications.** Item 8: drive the tile from `@Environment(\.sidebarRowSize)`, which Apple documents as mirroring Appearance › Sidebar icon size, and cover `SearchResultsList.swift:27` as well as the sidebar. PLA-4 glyph swap: rejection accepted — the reference confirms System Settings mixes outline and filled tiles. PLA-5 dimming: rejection accepted; I gated it on contrast myself. Item 3 resolves my Providers duplication.

## InformationReviewer — support

> INF ballot (information and content)
>
> 1. **Support.**
>
> 2. **One change — move the Sesh connection/setup rows out of the INF-1 deferral.** I inspected `reference/system-settings-network.png`: macOS uses “Not connected” in red beside Thunderbolt Bridge and iPhone USB as a _measured verdict_. That is the platform meaning Pico inherits on Sesh’s **Connection status**, **Sesh custom agent** and **Setup status** rows (`05-sesh-light.png`; `05-...ax.txt` lines 53–65), where nothing was measured. The deferral rests on the phrase being “quoted by the hard rule”, but `AGENTS.md:223` says scaffold controls _may_ read “Not connected” and in the same breath forbids reporting “a save, sign-in, connection or other operational success it did not perform”. Reporting a connection _outcome_ it did not perform is the same defect. I accept the rename rejection; the narrow fix is the value, not the label. Treat these three rows as an in-scope defect or a named Beads item, not a preference awaiting Mark.
>
> 3. **Condition:** item 5 (F) must leave a visible footer on every Sesh group — the footer is currently the only correction those rows get.
>
> 4. **Qualifications.** C: the new caution row or its footer must name the file (path or `settings.json`); today “this settings file” has no antecedent on Models (`16-...png`). L: split the `brew` synonym into its own one-word item — it blocks Homebrew recovery (job 1), unlike ⌘F. K: agree with the rejection; the header card is the only per-pane purpose statement. G (narrow) and 1/2/3: endorsed as written.

## TrustReviewer — support

> TrustReviewer ballot (choices and trust)
>
> 1. **Plan vote: support.**
>
> 2. **One change — widen item 6.** It names Install, Reinstall and Update but omits Trust markmals/tap, which goes through the same confirmation (`RuntimeSection.swift:53-62`), the same `perform`, and the same cancel-on-quit path (`RuntimeTerminationDelegate.swift:10-19`). Leaving one of four confirmations silent about the consequence makes the rule look arbitrary. Add the sentence there too: pure copy, no new capability.
>
> 3. **Conditions.** (a) Item 2 keeps `CommandErrorDetails`' 120 pt cap and scroll so Try Again is never pushed below the fold, and expands only on failures, never on benign rows. (b) Item 5's Providers footer must not read as "you have no providers" — it should say Pico doesn't show accounts here yet. (c) No Homebrew revocation instruction ships unverified (consistent with deferring O; I accept that deferral).
>
> 4. **Qualifications.** J: deferral acceptable because item 1 marks the saved-model-unavailable state, so the inverted badge stops being the only cue. For Mark's decision, note that `system-settings-general.png` and `-network.png` (both inspected) render the system's own "Software Update Available" badge as a gray capsule, while `DestinationList.swift:33` uses `.badgeProminence(.increased)` — Pico shouts about its benign state louder than macOS shouts about a pending update. F: `system-settings-network.png` (inspected) shows red-dot "Not connected" on Thunderbolt Bridge and iPhone USB — direct proof the phrase is a live verdict on this platform; the footer rewrite is correct but only a partial fix.

## Version 2 confirmations

Each reviewer was sent the version 2 amendments and asked whether support carries. Verbatim replies:

- **InteractionReviewer — support.** “support carries to version 2 — A1, A4 and the adopted conditions (no caution on the “Not Set” footer; Cancel/confirm-before-quit stays its own open item) resolve everything my ballot asked for. One non-blocking note on A3: “Not checked” on the Sesh rows implies a check the pane offers no way to run, so those footers should say the checking isn't built yet rather than leaving the row sounding merely pending.”
- **PlatformReviewer — support.** “Support carries to version 2 — A2 is exactly the narrowing I asked for, and my condition on the caution symbol no longer inheriting `.secondary` is recorded. One implementation note, not an objection: "while the header card is on screen" should be read literally, so the toolbar title reappears once the card scrolls out, as System Settings does.”
- **InformationReviewer — support.** “support carries to version 2. A3's “Not checked” is the right word — it already means “Pico performed no check” on General's Runtime rows (`01-general-light.png`), so Sesh now reuses the app's own vocabulary instead of borrowing the platform's verdict; A4, A2 and the deferred-but-filed `brew` item are all fine by me.”
- **AccessibilityReviewer — support.** “Support carries to version 2 — my conditions are in, and I accept the non-adoption of P: you're right that item 4's tree shape is statically verifiable with `recon` while announcement delivery is not, which is a sharper line than the one I drew, so deferring it with a VoiceOver pass and preserved dissent is the correct call. A2 keeping the window title while the toolbar title hides is exactly the right split for assistive clients.”
- **TrustReviewer — support.** “support carries to version 2. One note on A3, not an objection: "Not checked" is the right escape from a false verdict, but it now means two different things in the app — a real, repeatable check on General › Updates and a check Pico cannot perform at all on Sesh — so A3's honesty depends on every Sesh group keeping its "Nothing is read from Sesh…" footer, as drafted.”
- **PerceptionReviewer — support.** “**support** carries to version 2 — A2 resolves my amendment exactly, and the adopted conditions keep the caution signal scarce (no caution on informational footers, `.secondary` no longer overriding the symbol). One note, not an objection: my contrast condition isn't listed among the adopted conditions, so I read it as verification scope — the caution symbol measured ≥3:1 against the card fill in light, dark and Increase Contrast before the change is accepted on the running build.”

## Tally

| Plan      | Support | Object | Abstain | Agreement |
| --------- | ------- | ------ | ------- | --------- |
| Version 1 | 6       | 0      | 0       | 100 %     |
| Version 2 | 6       | 0      | 0       | 100 %     |

Threshold (≥ 80 %) met on both versions. Open regardless of vote: ACC-2 (disabled pop-up contrast, including the “Not Set” Reasoning row in capture 11, which has no adjacent explanation) pending an Increase Contrast measurement.
