# Attribution

Source: the `appkit-packaging` skill from [markmals/mac-dev-skills](https://github.com/markmals/mac-dev-skills) (`plugins/appkit/skills/appkit-packaging`), vendored on 2026-10-25.

The bundled scripts (`scripts/notarize.ts`, `scripts/app-store-upload.ts`, `scripts/mas-export-submit.ts`) were ported from the upstream bash versions; they are usable standalone and need nothing but Bun ≥ 1.4.4 and the Apple tools they drive.

## What this copy changes, and why

- **`description` rewritten** to the "Use when…" trigger form the rest of this template's skills use, and widened past AppKit: the app here is SwiftUI on iPhone, iPad and Mac, while the signing, notarization and App Store Connect pipelines it documents are framework-independent.
- **References to sibling skills that this template does not ship** (`appkit-private-apis`, `appkit-app-inspector`, `appkit-dev-workflow`) were removed. The private-API advisory they anchored is kept — only the cross-skill pointers are gone.
- **Build commands point at this template's tasks** (`mise run release`, `mise run generate`) instead of `build-and-run.sh`, which belongs to a skill that is not shipped here.
- **`references/ci-and-app-store.md` was updated** to the pipeline this template actually ships: the `xcode-27` runner image, `actions/checkout@v7`, `jdx/mise-action@v5`, `actions/upload-artifact@v7`, and secrets split between one GitHub Actions secret (the Developer ID `.p12`) and fnox (the App Store Connect API key, Team ID).
- **The three bundled scripts were rewritten from bash to TypeScript** (`notarize.sh` → `notarize.ts`, and likewise for `app-store-upload` and `mas-export-submit`), run as `bun .agents/skills/appkit-packaging/scripts/<name>.ts` on Bun, which executes TypeScript directly, with `node:test` tests beside them. This template ships no shell and no Python scripts; the `xcrun`, `codesign`, `ditto`, `xcodebuild` and `altool` invocations, their flags, their messages and their exit codes are unchanged. Two deliberate differences: `notarize.ts --help` exits 0 instead of 2, and `mas-export-submit.ts` treats a missing or malformed argument as a usage error (prints the usage, exits 2) where upstream exited 1 — runtime failures still exit 1. The port also drops an upstream bug: `notarize.sh` expanded an empty `ENT_ARGS` array under `set -u`, so on stock macOS bash 3.2 it aborted with `ENT_ARGS[@]: unbound variable` unless `--entitlements` was passed.
- **Every command is written from the project root**, because that is where an agent working in this repository stands: `bun .agents/skills/appkit-packaging/scripts/notarize.ts …`, not `bun scripts/notarize.ts`. Upstream assumes the skill directory is the working directory; there is no `scripts/` at a copied project's root.
- **The Gatekeeper assessment of the `.app` is `spctl -a -t exec -vv`**, upstream's `-t install`. `--type install` assesses installer packages: `spctl -a -t install -vv` on a valid, Apple-signed `.app` prints `rejected` and exits 3, so the upstream line would have failed every run that reached it, or passed for the wrong reason. The `.dmg` assessment keeps `-t install` — a disk image is a container, not executable code.

## One deliberate divergence from the bundled scripts

`scripts/app-store-upload.ts` and `scripts/mas-export-submit.ts` stage the App Store Connect `.p8` key into `~/.appstoreconnect/private_keys/` so `altool` can find it. This template's `tools/release.ts` instead writes the key to a `mktemp -d` directory and points `altool` at it with `API_PRIVATE_KEYS_DIR`, removing it on exit — same `altool` search behaviour, no private key left in a home directory. If you run the bundled scripts directly, be aware they take the `$HOME` route.
