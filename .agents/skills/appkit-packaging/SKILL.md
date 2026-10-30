---
name: appkit-packaging
description: "Use when preparing an Apple release build for distribution — signing an app, notarizing with notarytool, stapling a ticket, building a signed .dmg or .pkg, diagnosing a notarization rejection or Gatekeeper failure, uploading to App Store Connect, distributing a beta through TestFlight, or wiring release packaging into CI."
---

> In this template the whole pipeline is already wired: `mise run release -- --channel macos` does the Developer ID chain, `mise run release -- --channel testflight` does the App Store Connect upload, and both read their App Store Connect API key from fnox. Read `tools/release.ts` first; this skill is the reference behind it and the place to look when a step fails.

### Distribution paths

macOS has a few distinct release pipelines — pick first:

- **Developer ID (outside the App Store).** Sign with a **Developer ID Application** cert, **notarize** with Apple, **staple** the ticket, ship a `.dmg` or `.pkg`. This is the bulk of this skill.
- **TestFlight (beta).** Upload an App-Store-signed build to App Store Connect, then distribute to internal/external testers via the **TestFlight** app on macOS. No notarization; uses App Review (lightweight Beta App Review for external testers). The on-ramp to a Mac App Store release. See `references/ci-and-app-store.md`.
- **Mac App Store.** Sign with **Apple Distribution** / **3rd Party Mac Developer** certs, upload to App Store Connect; the store does **App Review** (not notarization) and re-signs for delivery. There is no clean first-party CLI submit — it's Transporter / Xcode Organizer. See `references/ci-and-app-store.md`.

TestFlight and the Mac App Store share the same build, certs, and upload step — TestFlight is the beta stage of that one pipeline, not a separate signing path. This is the macOS analog of WinUI's MSIX-signing vs. Microsoft-Store split.

### Private APIs & distribution (advisory)

If the app uses private APIs, method swizzling, or anything learned by runtime-inspecting another app, the pipeline choice above is also a **policy** choice — surface it, don't gate on it:

- **App Store review may reject private-API usage** — Apple judges **case-by-case**, there's no public allow-list, and not every use is auto-rejected. Hiding a private class name from the static scanner (no string literals, `object_getIvar` over KVC) defeats _static_ analysis only; it does **not** make runtime use policy-safe.
- **Developer ID + notarization is the escape hatch.** If review rejects it — or to avoid the question — ship **outside** the store (web / Sparkle / direct download), the Developer-ID flow that is the bulk of this skill. Private APIs are allowed there; you own the risk that an OS update breaks them.
- **Inspection tooling never ships.** A dylib injected into another app to learn how it works is a dev-only tool; only _knowledge_ (a font, a constraint) crosses into the product, never the tool or any injection step.

This is a trade-off to state, not a gate.

### Quick Reference (Developer ID)

| Task | Command |
| --- | --- |
| Build for release | `mise run release -- --channel macos` (or `xcodebuild -configuration Release archive`) |
| List signing identities | `security find-identity -v -p codesigning` |
| Strip quarantine before signing | `xattr -cr MyApp.app` |
| Sign (hardened runtime + timestamp) | `codesign --force --options runtime --timestamp --sign "Developer ID Application: NAME (TEAMID)" MyApp.app` |
| Verify signature | `codesign --verify --deep --strict --verbose=2 MyApp.app` |
| Zip for notarization | `ditto -c -k --keepParent MyApp.app MyApp.zip` |
| Store notary credentials (once) | `xcrun notarytool store-credentials "AC_NOTARY" --apple-id … --team-id … --password <app-specific>` |
| Submit + wait | `xcrun notarytool submit MyApp.zip --keychain-profile "AC_NOTARY" --wait` |
| Read a rejection log | `xcrun notarytool log <submission-id> --keychain-profile "AC_NOTARY" log.json` |
| Staple the ticket | `xcrun stapler staple MyApp.app` |
| Gatekeeper check | `spctl -a -t exec -vv MyApp.app` |

> The `scripts/notarize.ts` script bundled with this skill runs the whole sign → zip → submit → staple → verify chain (`bun .agents/skills/appkit-packaging/scripts/notarize.ts …` from the project root, Bun ≥ 1.4.4, no dependencies). Use it once you have a Release build and a stored notary profile.

### End-to-End Workflow (Developer ID)

#### Step 1 — Build for release

```bash
mise run release -- --channel macos    # does steps 1–7 below
```

Or archive by hand when you need to inspect an intermediate product:

```bash
mise run generate
xcodebuild -workspace MyApp.xcworkspace -scheme MyApp -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath ./build \
  -archivePath ./build/MyApp.xcarchive archive
```

#### Step 2 — Find your signing identity (one-time)

```bash
security find-identity -v -p codesigning
```

You need a **"Developer ID Application: Your Name (TEAMID)"** identity in the login keychain. If you only see Apple Development / Apple Distribution, you don't have a Developer ID cert yet — create one in the Apple Developer portal (Certificates → Developer ID Application) and download it. `TEAMID` is your 10-character team identifier.

#### Step 3 — Sign (inside-out, hardened runtime, timestamped)

Notarization **requires** the hardened runtime (`--options runtime`) and a secure timestamp (`--timestamp`). Sign **nested code first, the app bundle last** — frameworks, helpers, XPC services, then the `.app`. Apple discourages `--deep` for production; sign each nested item explicitly.

```bash
xattr -cr MyApp.app           # remove any quarantine xattrs first
IDENTITY="Developer ID Application: Your Name (TEAMID)"

# nested code, deepest first (frameworks, helpers, plugins) — example:
find MyApp.app/Contents/Frameworks -name "*.framework" -o -name "*.dylib" | while read -r item; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$item"
done

# then the app bundle itself
codesign --force --options runtime --timestamp \
  --entitlements MyApp.entitlements \
  --sign "$IDENTITY" MyApp.app

codesign --verify --deep --strict --verbose=2 MyApp.app   # 0 = good
```

If you need runtime exceptions (JIT, disabling library validation for plug-ins, etc.), declare them in `MyApp.entitlements` — keep them minimal.

#### Step 4 — Store notary credentials (one-time)

Create an **app-specific password** at appleid.apple.com, then cache a notarytool profile in the keychain so later submits need no secrets:

```bash
xcrun notarytool store-credentials "AC_NOTARY" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "abcd-efgh-ijkl-mnop"     # the app-specific password
```

(Alternatively authenticate with an App Store Connect API key: `--key`, `--key-id`, `--issuer`.)

#### Step 5 — Notarize and wait

notarytool wants an archive — a `.zip` (use `ditto`, **not** Finder/`zip`, to preserve the bundle), or submit a `.dmg`/`.pkg` directly.

```bash
ditto -c -k --keepParent MyApp.app MyApp.zip
xcrun notarytool submit MyApp.zip --keychain-profile "AC_NOTARY" --wait
```

`--wait` blocks until Apple returns `Accepted` or `Invalid`. On `Invalid`, pull the log — it names the exact unsigned/misconfigured binary:

```bash
xcrun notarytool log <submission-id> --keychain-profile "AC_NOTARY" log.json
```

#### Step 6 — Staple

Attach the notarization ticket so Gatekeeper passes **offline**. Staple the artifact you ship:

```bash
xcrun stapler staple MyApp.app        # staple the app (then re-package), or
xcrun stapler staple MyApp.dmg        # staple the dmg/pkg you distribute
```

(You can't staple a `.zip` — staple the `.app` inside, or staple the `.dmg`/`.pkg`.)

#### Step 7 — Verify like a first-run user would

```bash
spctl -a -t exec -vv MyApp.app        # expect: accepted, source=Notarized Developer ID
xcrun stapler validate MyApp.app
codesign --verify --deep --strict --verbose=2 MyApp.app
```

#### Step 8 — Package for distribution

**DMG** (drag-to-Applications):

```bash
# simplest:
hdiutil create -volname "MyApp" -srcfolder MyApp.app -ov -format UDZO MyApp.dmg
# nicer (background, /Applications symlink): brew install create-dmg
create-dmg --volname "MyApp" --app-drop-link 450 160 MyApp.dmg MyApp.app
```

Then **sign and staple the DMG itself** so the download is trusted as one unit:

```bash
codesign --force --timestamp --sign "$IDENTITY" MyApp.dmg
xcrun stapler staple MyApp.dmg
```

**PKG** (installer, e.g. needs a privileged step):

```bash
pkgbuild --component MyApp.app --install-location /Applications MyApp-comp.pkg
productbuild --package MyApp-comp.pkg \
  --sign "Developer ID Installer: Your Name (TEAMID)" MyApp.pkg
xcrun notarytool submit MyApp.pkg --keychain-profile "AC_NOTARY" --wait
xcrun stapler staple MyApp.pkg
```

(PKG signing uses the **Developer ID Installer** cert — a different cert from Application signing.)

### Key Rules

- **Notarization needs hardened runtime + timestamp.** Missing either → `Invalid`. (`--options runtime --timestamp`.)
- **Sign nested code inside-out**, app bundle last. Avoid `--deep` for production.
- **Use `ditto -c -k --keepParent`** to zip for notarization — Finder's "Compress" and plain `zip` mangle bundle symlinks/metadata and fail.
- **Staple the artifact you actually ship** (the `.app` inside the dmg, or the dmg/pkg). A stapled ticket is what lets Gatekeeper pass without network.
- **The DMG/PKG itself should be signed and (for dmg) stapled**, not just the app inside it.
- **App Store is a different cert + flow** — don't sign a store build with Developer ID. See the reference.
- **Never disable Gatekeeper or tell users to `xattr -d` your download** as a "fix" — that masks a real signing/notarization failure.

### CI/CD

`references/ci-and-app-store.md` has the full **GitHub Actions** release pipeline (macOS runner, import a base64 cert into a temporary keychain, build → sign → notarize → staple → upload artifact) plus the Mac App Store submission notes. In this template `.github/workflows/release.yml` already carries that job and calls the same task you run locally:

```yaml
jobs:
    release-macos:
        runs-on: xcode-27
        steps:
            - uses: actions/checkout@v7
            - uses: maxim-lobanov/setup-xcode@v1
              with: { xcode-version: "27" }
            - uses: jdx/mise-action@v5
            # import the Developer ID cert from secrets into a temp keychain, then:
            - run: mise run --yes release -- --channel macos --build "${{ github.run_number }}"
```

### TestFlight (beta distribution)

Before a Mac App Store release, distribute betas through **TestFlight** — same App-Store-signed build, same App Store Connect upload, but testers install via the **TestFlight app on macOS** (macOS 12+). It does **not** use Developer ID or notarization.

Flow:

1. **Build an App Store package** exactly as for the store (App Sandbox on, Apple Distribution signing, an increasing `CFBundleVersion`) — see the App Store section in `references/ci-and-app-store.md`. The same archive feeds both TestFlight and a store release.
2. **Upload to App Store Connect** (Xcode Organizer → Distribute → App Store Connect, the Transporter app, `xcrun altool --upload-app`, or the App Store Connect API in CI). Processing takes ~5–30 min.
3. **Provide Test Information** in the app's **TestFlight** tab (beta description, what to test, feedback email) — required before external testing.
4. **Add testers:**
    - **Internal** — up to 100 App Store Connect users on your team; builds are available **immediately after processing, no review**. (Builds can be marked "TestFlight Internal Only".)
    - **External** — up to 10,000 testers via email or a public link; the first build (and significant changes) must pass a lightweight **Beta App Review**.
5. **Testers install** via the macOS TestFlight app and send feedback/crash reports. **Builds expire 90 days** after upload; ship a new build to continue.

Don't use TestFlight to ship to end users in place of the store — Apple prohibits it and it risks account action. See `references/ci-and-app-store.md` for the upload commands, `ExportOptions.plist`, and CI automation (shared with the App Store section).

### Mac App Store pipeline (build → export → upload)

TestFlight and the Mac App Store are **one** pipeline — and it is a different beast from Developer ID. The load-bearing differences (mixing them = rejection):

|  | Developer ID (web / Sparkle) | App Store / TestFlight |
| --- | --- | --- |
| App signing cert | **Developer ID Application** | **Apple Distribution** |
| Installer cert | Developer ID Installer | **Mac Installer Distribution** (_not_ Developer ID Installer) |
| Hardened runtime | **required** (`--options runtime`) | not used |
| App Sandbox | optional | **mandatory** — `com.apple.security.app-sandbox` |
| Apple gate | **notarization** (`notarytool`) | **App Review** (no notarization) |
| Upload artifact | signed `.dmg` / `.pkg` | signed flat `.pkg` |
| Provisioning profile | none | Mac App Store profile for the bundle id |

> **`notarytool` is NOT a store uploader.** It only talks to the notary service (Developer ID). Store/TestFlight upload is `altool --upload-app`, Transporter, or the App Store Connect API — never `notarytool`.

**Flow (steps 2–3 are the bundled scripts):**

1. **Archive** with App Sandbox on and an increasing `CFBundleVersion`: `xcodebuild -scheme MyApp -configuration Release archive -archivePath MyApp.xcarchive`.
2. **Export** from the xcarchive with an `ExportOptions.plist` whose `method` is **`app-store-connect`** — **`app-store` is deprecated** (Xcode 27 still accepts it as an alias, but use the current value):
    ```bash
    xcodebuild -exportArchive -archivePath MyApp.xcarchive \
      -exportOptionsPlist ExportOptions-AppStore.plist -exportPath ./export
    ```
    (Set `destination = upload` in the plist to have `xcodebuild` upload directly and skip step 3.)
3. **Upload** with the App Store Connect **API key** — no interactive passwords:
    ```bash
    xcrun altool --validate-app -f ./export/MyApp.pkg -t macos --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
    xcrun altool --upload-app   -f ./export/MyApp.pkg -t macos --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
    ```
    > **CI trap:** `altool` takes **no key path** — it searches `./private_keys`, `~/private_keys`, `~/.private_keys`, `~/.appstoreconnect/private_keys`, and `$API_PRIVATE_KEYS_DIR` for a file named exactly `AuthKey_<KEYID>.p8`. In CI, base64-decode your `.p8` into one of those dirs under that name first (or pass `--p8-file-path`). (`notarytool`, by contrast, takes `--key <path>`.) For a **Team** API key pass `--apiIssuer`; for an **Individual** key **omit** it (passing it returns 401).
4. **Submit for Review** — **no first-party CLI** for the final submit; do it in App Store Connect (or `fastlane deliver` / the ASC API). TestFlight internal testers get the build right after processing with no review.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `errSecInternalComponent` on codesign | Identity not in the keychain or keychain locked — `security unlock-keychain`; confirm with `find-identity` |
| notarytool returns `Invalid` | `notarytool log <id>` — almost always an unsigned/un-hardened nested binary; re-sign it inside-out |
| `The binary is not signed with a valid Developer ID certificate` | You signed with Apple Development, not Developer ID Application |
| `code object is not signed at all` (nested) | A framework/helper was missed — sign every nested Mach-O before the bundle |
| "App is damaged and can't be opened" on another Mac | Not notarized/stapled, or shipped a `zip` made by Finder — notarize + staple, repackage with `ditto`/`create-dmg` |
| `spctl` says `source=Unnotarized Developer ID` | Notarization didn't complete or wasn't stapled — finish Steps 5–6 |
| Hardened-runtime crash (e.g. plug-in won't load) | Add the specific entitlement (library-validation/JIT) — minimally — and re-sign |
| `stapler staple` → `Error 65 / could not find ticket` | Notarization for that exact binary hasn't propagated yet, or you stapled before `Accepted` — wait, re-staple |

### References

Paths below are relative to this skill's directory. From the project root they read `.agents/skills/appkit-packaging/<path>`, which is also how the scripts are invoked: `bun .agents/skills/appkit-packaging/scripts/notarize.ts …`.

| File | Read when… |
| --- | --- |
| `scripts/notarize.ts` | Developer ID: sign → notarize (`notarytool`) → staple → verify, run for you — ASC API key, no passwords |
| `scripts/app-store-upload.ts` | Validate + upload a store `.pkg` to App Store Connect (TestFlight / MAS) with an ASC API key |
| `scripts/mas-export-submit.ts` | Archive → export (`method=app-store-connect`) → upload for the Mac App Store |
| `references/ci-and-app-store.md` | GitHub Actions release CI, `ExportOptions.plist` templates (Developer ID + App Store), App Sandbox entitlements, tester management |
