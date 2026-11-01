import ProjectDescription

// Tuist generates the ignored Xcode project and workspace from this manifest.
let project = Project(
    name: "Pico",
    settings: .settings(
        base: [
            "SWIFT_VERSION": "6.0",
            "SWIFT_STRICT_CONCURRENCY": "complete",
            "SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY": "YES",
            // The Swift compiler extracts the app's LocalizedStringResource literals
            // into app/Localizable.xcstrings, as Xcode's own app template does.
            "SWIFT_EMIT_LOC_STRINGS": "YES",
            // Local configuration checks do not need signing credentials.
            "CODE_SIGNING_ALLOWED": "NO",
            // Direct OMP configuration access is used for the prototype; sandbox
            // integration is not configured.
            "ENABLE_APP_SANDBOX": "NO",
        ],
        configurations: [
            // `version:sync` projects package.json into this xcconfig.
            .debug(name: "Debug", xcconfig: "Config/Version.xcconfig"),
            .release(name: "Release", xcconfig: "Config/Version.xcconfig"),
        ]
    ),
    targets: [
        .target(
            name: "Pico",
            destinations: .macOS,
            product: .app,
            bundleId: "me.malstrom.pico",
            // Packaged engine compatibility must be verified against this floor.
            deploymentTargets: .macOS("27.0"),
            infoPlist: .extendingDefault(
                with: [
                    "CFBundleDisplayName": "Pico",
                    "LSApplicationCategoryType": "public.app-category.productivity",
                    // pico://settings links open panes and settings (proposal 0005).
                    "CFBundleURLTypes": [
                        [
                            "CFBundleURLName": "me.malstrom.pico.settings",
                            "CFBundleURLSchemes": ["pico"],
                        ]
                    ],
                ]
            ),
            // The app's own Swift, and the string catalog its localized titles and
            // copy resolve through. Both are globs: a new file under app/ is picked
            // up by the next generation, and the generated project is never edited.
            // Tests sit beside the code they test and belong to PicoTests instead.
            sources: [.glob("app/**/*.swift", excluding: ["app/**/*Tests.swift"])],
            resources: ["app/**/*.xcstrings"]
        ),
        .target(
            name: "PicoTests",
            destinations: .macOS,
            product: .unitTests,
            bundleId: "me.malstrom.pico.tests",
            deploymentTargets: .macOS("27.0"),
            infoPlist: .default,
            sources: ["app/**/*Tests.swift"],
            dependencies: [.target(name: "Pico")]
        ),
    ]
)
