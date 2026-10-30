import ProjectDescription

// Tuist generates the ignored Xcode project and workspace from this manifest.
let project = Project(
    name: "Pico",
    settings: .settings(
        base: [
            "SWIFT_VERSION": "6.0",
            "SWIFT_STRICT_CONCURRENCY": "complete",
            "SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY": "YES",
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
                ]
            ),
            // Metadata-only target; real app sources are required before building.
            sources: []
        )
    ]
)
