# Reference

## Opening questions

One focused round, roughly a dozen questions, before any design exists. Skip it only for small tweaks, follow-ups, or a brief that already answers these. Offer concrete options rather than open prompts — people answer "tabs or sidebar?" far more readily than "how should navigation work?".

**Context — ask these every time.**

1. Which platforms, and which one is primary? A design that serves iPhone first is a different design from one that serves Mac first.
2. Is there an existing app, codebase, screenshot set, or brand to match? If yes, ask for it — matching an existing visual vocabulary beats inventing one.
3. Which Apple app is the closest cousin to what you're building?
4. What is the app's core job, in one sentence? Which single screen matters most?

**Scope.**

5. Which screens and flows are in this pass? What is explicitly out?
6. Navigation model: tab bar, sidebar, split view, or a single stack?
7. Is there real sample content available, or should fixtures be invented?
8. Which data conditions actually matter here — first run, offline, an enormous library, a partially synced state?

**Direction.**

9. How by-the-book versus distinctive? Pure system look, or a strong custom identity inside native components?
10. How many variations would you like, and along which dimension — navigation, density, visual tone, or the flow itself?
11. Anything you already know you dislike, or a competitor look to avoid?
12. Accessibility ambition beyond the floor (large text, VoiceOver, reduced motion)?

Report the answers you assumed when the user doesn't respond to all of them, rather than silently picking. Never invent scope: if extra screens or content seem valuable, propose them instead of adding them.

## Finding Apple's guidance

Look for a local Human Interface Guidelines mirror before reaching for the network:

```bash
ls -d "$(dirname "$SKILL_DIR")"/apple-hig-* 2>/dev/null
```

It contains one Markdown file per HIG page (`lists-and-tables.md`, `split-views.md`, `typography.md`, `color.md`, `materials.md`, `toolbars.md`, `sheets.md`, `alerts.md`, `navigation-bars.md`, `sidebars.md`, `widgets.md`, `accessibility.md`, …) with working cross-links. Without a mirror, use `https://developer.apple.com/design/human-interface-guidelines/<page>`.

Read the page for the _pattern_ being designed, not the whole HIG.

### Looking at the real thing

`bun .agents/skills/prototyping-apple-app-design/scripts/apple-ref.ts --app reminders` captures Apple's own app from the Simulator. Available: reminders, settings, maps, health, fitness, news, passwords, shortcuts, calendar, contacts, messages, photos, safari, files, wallet.

Music, Mail, Weather, Notes, Home, and Books are **not** in the simulator runtime. For those, read the HIG page rather than reconstructing the app from memory.

Two limits worth stating up front rather than discovering mid-capture:

- **These are iPhone captures.** There is no Mac equivalent — a Mac prototype pairs an iOS reference for tone and content density with the Mac HIG pages (`split-views`, `sidebars`, `toolbars`) for structure.
- **First launch shows onboarding**, and some apps render empty until they hold data. A welcome screen is not a reference; fall back to the HIG page when that happens.

Study structure, not decoration: where the primary action lives, what the empty state says, how dense the rows are, which chrome is present at which size.

## The current design language (OS 26 and later)

The 2025 redesign — **Liquid Glass** — is the defining visual fact of iOS 26/27 and macOS 26/27. Designing from a memory of iOS 17 produces something that reads as dated immediately: heavier chrome, opaque bars, squarer controls, denser toolbars.

**The single most important rule: you mostly do not write glass code.** Liquid Glass is a property of the _functional layer_ — tab bars, toolbars, sidebars, sheets, alerts, controls — and standard system components adopt it automatically when built against the SDK 26+ toolchain. A prototype that uses `List`, `Form`, `.toolbar`, and `NavigationSplitView` is already current. Reaching for the effect manually is usually a sign of rebuilding something the system provides.

What actually changed, and what to design for:

- **Controls float above content.** Bars are translucent and content scrolls beneath them. Don't paint an opaque background behind a toolbar to "fix" the see-through.
- **Rounder, more capsule-shaped controls**, with toolbar buttons often circular.
- **Concentric corners.** Nested containers share a curvature centre; matching the system's radii matters more than picking a favourite number.
- **Scroll edge effects** blur and fade content behind bars to protect legibility.
- **Bars minimize on scroll**, giving content more room.
- **Content extends under the chrome**, so full-bleed imagery needs edge treatment.

### Verified APIs

Present in the installed SDK; availability is iOS/macOS/tvOS/watchOS **26.0+**, which is why the template's deployment targets are 26.0. Do not invent members beyond these.

| API | Signature / values |
| --- | --- |
| `.glassEffect(_:in:)` | `glassEffect(_ glass: Glass = .regular, in shape: some Shape = DefaultGlassEffectShape())` |
| `Glass` | `.regular`, `.clear`, `.identity`, `.tint(Color?)`, `.interactive(Bool = true)` |
| `GlassEffectContainer` | `init(spacing: CGFloat? = nil, content:)` — **unavailable on visionOS** |
| `.glassEffectID(_:in:)` | morph a glass shape across states, with a `Namespace.ID` |
| `.glassEffectUnion(id:namespace:)` | merge adjacent glass shapes into one |
| `.glassEffectTransition(_:)` | `GlassEffectTransition` |
| Button styles | `.buttonStyle(.glass)`, `.buttonStyle(.glassProminent)` |
| `.backgroundExtensionEffect()` | extends content under chrome |
| `.scrollEdgeEffectStyle(_:for:)` | `.automatic`, `.soft`, `.hard` |
| `.scrollEdgeEffectHidden(_:for:)` | suppress the effect on an edge |
| `.tabBarMinimizeBehavior(_:)` | minimize the tab bar on scroll |

`glassEffect` and friends live in **SwiftUICore**, re-exported by SwiftUI — `import SwiftUI` is enough.

### Using it correctly

From the HIG's `materials.md`:

- **Never put Liquid Glass in the content layer.** It belongs to controls and navigation. Content-layer surfaces use standard materials (`.regularMaterial`).
- **Use it sparingly in custom views.** Limit it to the most important functional elements — a floating action control, a custom bar. Overuse distracts from content.
- **`.clear` only over visually rich backgrounds** such as photos or video, and add a ~35% dark dimming layer when the underlying content is bright.
- **Group related glass shapes** in a `GlassEffectContainer` so they blend and morph as one rather than as separate blobs.
- **Use vibrant/semantic foreground colours on top of materials**, never a fixed grey.

The template demonstrates exactly one custom use — the floating prototype-controls button — which is the textbook case: a small control hovering above content.

### Checking your work against it

`bun .agents/skills/prototyping-apple-app-design/scripts/apple-ref.ts --app settings` is the fastest way to see the current language: rounded grouped rows, translucent bars, generous corner radii, and a toolbar that behaves the way yours should.

## Native by default

Deviations should be deliberate and few. Everything below is what "looks like an Apple app" actually means in code.

| Area | Do | Never |
| --- | --- | --- |
| Color | `Color.primary`, `.secondary`, `.tint`, `Color(.systemGroupedBackground)` | Hardcoded hex; a second accent colour |
| Type | Text styles: `.largeTitle`, `.headline`, `.body`, `.caption` | Fixed point sizes; capping body text growth |
| Components | `List`, `Form`, `NavigationStack`, `NavigationSplitView`, `.toolbar`, `.searchable`, `ContentUnavailableView`, `.confirmationDialog` | Hand-rolled rows, custom empty states, bespoke nav bars |
| Symbols | SF Symbols; filled variants in tab bars, outline in nav bars | Emoji as iconography; invented symbol names |
| Layout | Safe areas, system margins, 44pt minimum targets | Hardcoded insets; edge-to-edge full-width buttons |
| Materials | `.regularMaterial` and friends with matching vibrancy | Custom blurs; mixed material semantics |
| Motion | Default animations; `withAnimation` on state change | Bespoke easing curves for ordinary transitions |

**Alerts** carry two choices, titles without terminal punctuation, and verbs rather than Yes/No. More than two choices means a confirmation dialog. Destructive actions confirm, and the destructive choice sorts first.

**Tab bars** hold three to five items. Needing a More tab means the hierarchy is wrong.

### AI-slop tells to avoid

Gradient hero backgrounds; serif "editorial" headlines on a utility app; a novel accent colour per screen; rounded cards with a coloured left border; drop shadows under every container; emoji standing in for icons; stat rows that display numbers nobody asked for. When a placeholder is needed, use a plain shape — a placeholder beats a bad imitation of the real asset.

## The four phases

`LoadPhase` forces the question. Each screen answers all four:

| Phase | Design question |
| --- | --- |
| `loading` | What holds the layout while data arrives? Prefer redacted real rows over a centred spinner — it also proves the loaded layout won't jump. |
| `empty` | What does a new user see? `ContentUnavailableView` with a real sentence, not "No data". |
| `loaded` | The content. |
| `failed` | What broke, in plain language, with a way forward. |

Capture all four: `bun .agents/skills/prototyping-apple-app-design/scripts/shoot.ts --project DIR --screen NAME --condition empty|slow|failing`.

## Offering options

When the ask is exploratory, the deliverable is a comparison, not a verdict. Add cases to `Variant`, branch on `@Environment(\.variant)` where the directions differ, and capture the set:

```bash
bun .agents/skills/prototyping-apple-app-design/scripts/shoot.ts --project DIR --screen libraryList --all-variants
```

Make the directions **disagree about something structural** — navigation model, list versus grid, information density, how much the app leans on imagery. Three options that differ only in accent colour waste the round trip.

Two to four is the useful range. Name them for the idea, not the order: `.dense`, `.imageLed`, `.sidebarFirst` — never `.optionA`.

Say which one you would ship and why, then let the captures make the argument.

## Reading a capture

Opening the PNG is not the same as reviewing it. Looking at a screenshot and saying "looks right" is how truncation ships. Go through these deliberately:

- **Truncation.** Any `…` in a label, sidebar row, or status is a layout failure, not a rendering detail. Widen the column, shorten the copy, or drop the field.
- **Collision and overlap**, especially at larger text sizes.
- **Alignment.** Do leading edges line up down the screen?
- **Density.** Compare against the first-party capture — Apple's rows are usually tighter than a first draft, and Mac rows are tighter than iOS ones.
- **Emptiness.** Large blank regions usually mean the layout was designed for more content than the fixtures provide.
- **The primary action.** Findable in one second, and only one per screen is prominent.

A full matrix — screens × variants × states × appearances — is dozens of files. Compose them into one image first, then open individual captures only where something looks off:

```bash
bun .agents/skills/prototyping-apple-app-design/scripts/contact-sheet.ts --project DIR --out /tmp/sheet.png --columns 6
bun .agents/skills/prototyping-apple-app-design/scripts/contact-sheet.ts --out /tmp/today.png --columns 3 DIR/.shots/today-*.png
```

It prints the cell order, so tiles can be named precisely when discussing them. A sheet is for comparison; it is too small to judge truncation, so still open the full-size capture for any screen you intend to call finished.

## The seam

```swift
@MainActor
protocol NotesBackend: AnyObject {
    func notes() async throws -> [Note]
    func setPinned(_ isPinned: Bool, for id: Note.ID) async throws
}
```

Rules:

- Views read a model from the environment; the model owns `any NotesBackend`.
- No view names a concrete backend. Grep for `Mock` in `Features/` — it should be empty.
- Domain models import neither SwiftUI nor a storage framework.
- `@MainActor` throughout is a deliberate prototype simplification. Record it in the handoff; production decides its own isolation.

### Going to production

1. Copy `Shared/Backend/<Domain>.swift` — the models move unchanged.
2. Write a real type conforming to the same protocol.
3. Inject it where `MockNotesBackend` was constructed.
4. Delete `Mock*`, `MockCondition`, and the knobs.
5. Screens and the design survive whether production is SwiftUI, UIKit, or AppKit — the captured PNGs and `DESIGN-NOTES.md` are the specification.

## Working in the project

Source folders are **file-system synchronized**: adding a `.swift` file anywhere under `Shared/` or `App/` puts it in the target with no project-file edit. This is the single biggest reason not to hand-write or hand-patch `project.pbxproj`.

Xcode and the agent can hold the same folder at once. Edits from either side appear live in the canvas; `#Preview` is the user's fast loop, `shoot.ts` is the agent's.

## Platform notes

| Platform | What changes |
| --- | --- |
| iPhone | `NavigationStack`; tab bar for 3–5 peers |
| iPad | `NavigationSplitView`; a stretched phone layout is the classic failure |
| Mac | Sidebar split view, denser rows, real toolbar, `Settings` scene, resizable window. Capture with `--platform macos` — it exposes iOS layouts that were never adapted |
| watchOS | List-first, short titles, no `Menu`, driven by launch flags rather than knobs |
| tvOS | Focus engine; no `swipeActions`; generous overscan margins |
| visionOS | Glass materials, ornaments, hover effects |

### Adding tvOS

The default target covers iPhone, iPad, Mac, and Vision Pro. For tvOS, add `appletvos appletvsimulator` to `SUPPORTED_PLATFORMS`, add `3` to `TARGETED_DEVICE_FAMILY`, set `TVOS_DEPLOYMENT_TARGET`, and guard the APIs tvOS lacks (`swipeActions`, `navigationBarTitleDisplayMode`) with `#if os(tvOS)`.

### Adding watchOS

`bun .agents/skills/prototyping-apple-app-design/scripts/new-prototype.ts --watch` adds a second target that shares `Shared/` and builds from `Watch/`. Watch screens are captured only by building; there is no simulator screenshot path unless a watchOS runtime is installed.

## Handoff: DESIGN-NOTES.md

Write this at the end. It is what survives the prototype.

```markdown
# <App> — Design Notes

## Screens

| Screen   | Purpose                     | Capture             |
| -------- | --------------------------- | ------------------- |
| noteList | Primary list, pin and swipe | .shots/noteList.png |

## Decisions

- Tint: <colour> and why
- Type: system styles only / deviations and why
- Density, navigation model, and the platform each screen targets

## States

Per screen: what loading, empty, and failure look like, with capture paths.

## The seam

`NotesBackend` — the only contract production must satisfy.

| Method    | Real source |
| --------- | ----------- |
| `notes()` | GET /notes  |

## Known simplifications

@MainActor everywhere; no persistence, auth, sync, or pagination.
```

## Accessibility floor

Not the full checklist — the parts that change a design and are free to get right now:

- Capture at `--text-size accessibility3` on iOS-family destinations; fix anything that truncates or collides. macOS does not scale with Dynamic Type, so this flag changes nothing there — check Mac text handling by resizing the window, or capture the shared views on iPad.
- Capture `--appearance dark`; semantic colours make this nearly free.
- Decorative images hidden from VoiceOver; meaningful ones labelled.
- Icon-only buttons carry an `accessibilityLabel`.
- Contrast: 4.5:1 under 17pt, 3:1 at 18pt or bold.
- Don't let colour alone carry meaning — pair it with a symbol or text.
